import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { METADATA_FILENAME, ORAS_COMMAND } from './constants';
import { resolveExportDir } from './config/exportPath';

const outputChannel = vscode.window.createOutputChannel('OCI Export');

interface ExportMetadata {
  reference: string;
  exportedAt: string;
  source: 'docker-daemon' | 'registry';
  tool: 'docker-save' | 'oras';
}

interface ExportImageOptions {
  source?: 'docker-daemon' | 'registry';
}

interface ParsedRegistryReference {
  registry: string;
  repository: string;
  referenceSuffix: string;
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

function hasExplicitRegistry(firstPathPart: string): boolean {
  return firstPathPart.includes('.') || firstPathPart.includes(':') || firstPathPart === 'localhost';
}

function parseReference(reference: string): { name: string; referenceSuffix: string } {
  const digestIndex = reference.indexOf('@');
  if (digestIndex >= 0) {
    return {
      name: reference.slice(0, digestIndex),
      referenceSuffix: reference.slice(digestIndex)
    };
  }

  const lastSlash = reference.lastIndexOf('/');
  const lastColon = reference.lastIndexOf(':');
  if (lastColon > lastSlash) {
    return {
      name: reference.slice(0, lastColon),
      referenceSuffix: reference.slice(lastColon)
    };
  }

  return { name: reference, referenceSuffix: '' };
}

function normalizeRegistryReference(reference: string): ParsedRegistryReference {
  const { name, referenceSuffix } = parseReference(reference);
  const nameParts = name.split('/').filter(Boolean);

  if (nameParts.length === 0) {
    throw new Error(`Invalid image reference: ${reference}`);
  }

  if (hasExplicitRegistry(nameParts[0])) {
    return {
      registry: nameParts[0],
      repository: nameParts.slice(1).join('/'),
      referenceSuffix
    };
  }

  if (nameParts.length === 1) {
    return {
      registry: 'docker.io',
      repository: `library/${nameParts[0]}`,
      referenceSuffix
    };
  }

  return {
    registry: 'docker.io',
    repository: nameParts.join('/'),
    referenceSuffix
  };
}

function toNormalizedRegistryReference(reference: string): string {
  const parsed = normalizeRegistryReference(reference);
  return `${parsed.registry}/${parsed.repository}${parsed.referenceSuffix}`;
}

async function resolveLocalImagePlatform(reference: string): Promise<string | null> {
  try {
    const result = await execFileAsync('docker', [
      'image',
      'inspect',
      '--format',
      '{{.Os}}/{{.Architecture}}{{if .Variant}}/{{.Variant}}{{end}}',
      reference
    ]);

    const platform = result.stdout.trim();
    return platform.length > 0 ? platform : null;
  } catch {
    return null;
  }
}

async function convertArchiveToOciLayout(
  archivePath: string,
  outputDir: string,
  sourceTag: string,
  destinationTag: string
): Promise<void> {
  outputChannel.appendLine('Converting archive to OCI layout with oras…');
  outputChannel.show(true);

  await spawnWithOutput(ORAS_COMMAND, [
    'cp',
    '--recursive',
    '--from-oci-layout',
    asTaggedLayoutRef(archivePath, sourceTag),
    '--to-oci-layout',
    asTaggedLayoutRef(outputDir, destinationTag)
  ]);
}

async function dockerSaveToTar(reference: string, tarPath: string, platform?: string): Promise<void> {
  const args = ['save'];
  if (platform) {
    args.push('--platform', platform);
  }
  args.push(reference, '-o', tarPath);

  outputChannel.appendLine(`Saving ${reference} with docker save…`);
  outputChannel.show(true);
  await spawnWithOutput('docker', args);
}

async function dockerSaveAndConvert(
  reference: string,
  outputDir: string,
  persistentTarPath?: string
): Promise<void> {
  let tarPath: string;
  let tempDir: string | undefined;

  if (persistentTarPath) {
    tarPath = persistentTarPath;
    fs.mkdirSync(path.dirname(tarPath), { recursive: true });
    if (fs.existsSync(tarPath)) {
      fs.rmSync(tarPath, { force: true });
    }
  } else {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oci-export-'));
    tarPath = path.join(tempDir, 'image.tar');
  }

  try {
    const referenceTag = getReferenceTag(reference) ?? 'latest';

    await dockerSaveToTar(reference, tarPath);

    try {
      await convertArchiveToOciLayout(tarPath, outputDir, referenceTag, referenceTag);
    } catch (error) {
      const localPlatform = await resolveLocalImagePlatform(reference);
      if (!localPlatform) {
        throw error;
      }

      outputChannel.appendLine(
        `Multi-platform conversion failed; retrying with concrete platform ${localPlatform}…`
      );
      await dockerSaveToTar(reference, tarPath, localPlatform);
      await convertArchiveToOciLayout(tarPath, outputDir, referenceTag, referenceTag);
    }
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

async function orasCopyFromRegistry(reference: string, outputDir: string): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });

  const registryReference = toNormalizedRegistryReference(reference);
  if (registryReference !== reference) {
    outputChannel.appendLine(`Normalized registry reference: ${reference} -> ${registryReference}`);
  }

  const destinationTag = getReferenceTag(registryReference) ?? 'latest';
  outputChannel.appendLine(`Copying ${registryReference} from registry with oras…`);
  outputChannel.show(true);

  await spawnWithOutput(ORAS_COMMAND, [
    'cp',
    '--recursive',
    registryReference,
    '--to-oci-layout',
    asTaggedLayoutRef(outputDir, destinationTag)
  ]);
}

async function exportFromDaemon(
  reference: string,
  outputDir: string,
  source: ExportMetadata['source'],
  persistentTarPath?: string
): Promise<void> {
  try {
    await dockerSaveAndConvert(reference, outputDir, persistentTarPath);
    writeExportMetadata(outputDir, reference, source, 'oras');
    outputChannel.appendLine('Conversion complete.');
    return;
  } catch (saveError) {
    const message = saveError instanceof Error ? saveError.message : String(saveError);
    outputChannel.appendLine(
      `docker save / oras conversion failed (${message}); falling back to pulling ${reference} from its registry…`
    );
  }

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  await orasCopyFromRegistry(reference, outputDir);
  writeExportMetadata(outputDir, reference, source, 'oras');
  outputChannel.appendLine('Registry fallback export complete.');
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

  if (!(await isCommandAvailable(ORAS_COMMAND))) {
    throw new Error('oras is required for OCI layout export.');
  }

  outputChannel.show(true);
  if (fs.existsSync(outputDir)) {
    outputChannel.appendLine(`OCI layout target already exists: ${outputDir}`);
    outputChannel.appendLine(`Deleting existing directory: ${outputDir}`);
    fs.rmSync(outputDir, { recursive: true, force: true });
    outputChannel.appendLine(`Deleted existing directory: ${outputDir}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  outputChannel.appendLine(`Created OCI layout directory: ${outputDir}`);

  if (source === 'registry') {
    outputChannel.appendLine('Using registry export flow: oras cp directly to OCI layout.');
    await orasCopyFromRegistry(reference, outputDir);
    writeExportMetadata(outputDir, reference, 'registry', 'oras');
    outputChannel.appendLine('Direct registry export complete.');
    return outputDir;
  }

  const persistentTarPath = configuredDir
    ? path.join(configuredDir, `${imageDirName}.tar`)
    : undefined;

  await exportFromDaemon(reference, outputDir, source, persistentTarPath);
  return outputDir;
}
