import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { METADATA_FILENAME } from './constants';
import { resolveExportDir } from './config/exportPath';

const outputChannel = vscode.window.createOutputChannel('OCI Export');

interface ExportMetadata {
  reference: string;
  exportedAt: string;
  source: 'docker-daemon' | 'registry';
  tool: 'skopeo' | 'docker-save' | 'oras';
}

interface ExportImageOptions {
  source?: 'docker-daemon' | 'registry';
}

function writeExportMetadata(
  outputDir: string,
  reference: string,
  source: ExportMetadata['source'],
  tool: ExportMetadata['tool']
): void {
  const metadata: ExportMetadata = {
    reference,
    exportedAt: new Date().toISOString(),
    source,
    tool
  };
  fs.writeFileSync(path.join(outputDir, METADATA_FILENAME), JSON.stringify(metadata, null, 2));
}

function sanitizeImageName(reference: string): string {
  return reference.replace(/[/:@]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function spawnWithOutput(
  file: string,
  args: string[],
  options?: childProcess.SpawnOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    outputChannel.appendLine(`> ${file} ${args.join(' ')}`);
    const proc = childProcess.spawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stdout?.on('data', (data: Buffer) => {
      outputChannel.append(data.toString());
    });

    proc.stderr?.on('data', (data: Buffer) => {
      outputChannel.append(data.toString());
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${file} exited with code ${code}`));
      }
    });
  });
}

function execFileAsync(
  file: string,
  args: string[],
  options?: childProcess.ExecFileOptions
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(file, args, { ...options, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
      }
    });
  });
}

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version'], { timeout: 5000 });
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

async function exportWithSkopeo(
  reference: string,
  outputDir: string,
  source: ExportMetadata['source']
): Promise<void> {
  outputChannel.appendLine(`Exporting ${reference} with skopeo…`);
  outputChannel.show(true);
  const inputReference = source === 'registry' ? `docker://${reference}` : `docker-daemon:${reference}`;
  await spawnWithOutput('skopeo', ['copy', '--all', inputReference, `oci:${outputDir}`]);
  writeExportMetadata(outputDir, reference, source, 'skopeo');
  outputChannel.appendLine('skopeo export complete.');
}

function getReferenceTag(reference: string): string | null {
  const lastSlash = reference.lastIndexOf('/');
  const lastColon = reference.lastIndexOf(':');
  if (lastColon > lastSlash) {
    return reference.slice(lastColon + 1);
  }

  return null;
}

function asTaggedLayoutRef(layoutPath: string, tag: string): string {
  return `${layoutPath}:${tag}`;
}

async function convertArchiveToOciLayout(
  archivePath: string,
  outputDir: string,
  reference: string
): Promise<void> {
  outputChannel.appendLine('Converting archive to OCI layout with oras…');
  outputChannel.show(true);

  const requestedTag = getReferenceTag(reference);
  const destinationTag = requestedTag ?? 'latest';
  const candidateTags = Array.from(new Set([requestedTag, 'latest'].filter((tag): tag is string => Boolean(tag))));

  let lastError: unknown;
  for (const sourceTag of candidateTags) {
    try {
      await spawnWithOutput('oras', [
        'cp',
        '--from-oci-layout',
        asTaggedLayoutRef(archivePath, sourceTag),
        '--to-oci-layout',
        asTaggedLayoutRef(outputDir, destinationTag)
      ]);
      return;
    } catch (error) {
      lastError = error;
      outputChannel.appendLine(`oras copy failed for source tag ${sourceTag}; trying next option...`);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to convert archive with oras using available tag candidates.');
}

async function exportWithDockerSave(
  reference: string,
  outputDir: string,
  source: ExportMetadata['source']
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oci-export-'));

  try {
    const tarPath = path.join(tempDir, 'image.tar');

    outputChannel.appendLine(`Saving ${reference} with docker save…`);
    outputChannel.show(true);
    await spawnWithOutput('docker', ['save', reference, '-o', tarPath]);
    await convertArchiveToOciLayout(tarPath, outputDir, reference);
    writeExportMetadata(outputDir, reference, source, 'oras');
    outputChannel.appendLine('Conversion complete.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function exportRegistryDirect(reference: string, outputDir: string): Promise<void> {
  outputChannel.appendLine(`Copying ${reference} directly from registry with oras…`);
  outputChannel.show(true);

  const destinationTag = getReferenceTag(reference) ?? 'latest';
  await spawnWithOutput('oras', [
    'cp',
    '--recursive',
    reference,
    '--to-oci-layout',
    asTaggedLayoutRef(outputDir, destinationTag)
  ]);

  writeExportMetadata(outputDir, reference, 'registry', 'oras');
  outputChannel.appendLine('Direct registry export complete.');
}

async function pullImage(reference: string): Promise<void> {
  outputChannel.appendLine(`Pulling ${reference} from registry with docker…`);
  outputChannel.show(true);
  await spawnWithOutput('docker', ['pull', reference]);
}

export async function exportImageToOciLayout(reference: string, options?: ExportImageOptions): Promise<string> {
  const source = options?.source ?? 'docker-daemon';
  const configuredDir = await resolveExportDir();
  const imageDirName = sanitizeImageName(reference);

  let outputDir: string;
  if (configuredDir) {
    outputDir = path.join(configuredDir, imageDirName);
  } else {
    outputDir = path.join(os.tmpdir(), 'oci-layouts', imageDirName);
  }

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  if (source === 'registry') {
    const hasOras = await isCommandAvailable('oras');
    if (hasOras) {
      try {
        await exportRegistryDirect(reference, outputDir);
        return outputDir;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Direct registry copy failed: ${message}`);
        outputChannel.appendLine('Falling back to skopeo/docker-based export path.');
      }
    }
  }

  const hasSkopeo = await isCommandAvailable('skopeo');
  if (hasSkopeo) {
    await exportWithSkopeo(reference, outputDir, source);
    return outputDir;
  }

  if (source === 'registry') {
    await pullImage(reference);
  }
  if (!(await isCommandAvailable('oras'))) {
    throw new Error('oras is required for docker-save conversion when skopeo is unavailable.');
  }
  await exportWithDockerSave(reference, outputDir, source);

  return outputDir;
}
