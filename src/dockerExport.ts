import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { METADATA_FILENAME } from './constants';
import { resolveExportDir } from './config/exportPath';

const outputChannel = vscode.window.createOutputChannel('OCI Export');

interface DockerManifestEntry {
  Config: string;
  RepoTags: string[] | null;
  Layers: string[];
}

interface ExportMetadata {
  reference: string;
  exportedAt: string;
  source: 'docker-daemon';
  tool: 'skopeo' | 'docker-save';
}

function writeExportMetadata(outputDir: string, reference: string, tool: ExportMetadata['tool']): void {
  const metadata: ExportMetadata = {
    reference,
    exportedAt: new Date().toISOString(),
    source: 'docker-daemon',
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

async function computeFileHash(filePath: string): Promise<{ digest: string; size: number }> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let size = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data: Buffer | string) => {
      hash.update(data);
      size += typeof data === 'string' ? Buffer.byteLength(data) : data.length;
    });
    stream.on('end', () => resolve({ digest: hash.digest('hex'), size }));
    stream.on('error', reject);
  });
}

function computeBufferHash(buffer: Buffer): { digest: string; size: number } {
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  return { digest: hash.digest('hex'), size: buffer.length };
}

async function exportWithSkopeo(reference: string, outputDir: string): Promise<void> {
  outputChannel.appendLine(`Exporting ${reference} with skopeo…`);
  outputChannel.show(true);
  await spawnWithOutput('skopeo', ['copy', `docker-daemon:${reference}`, `oci:${outputDir}`]);
  writeExportMetadata(outputDir, reference, 'skopeo');
  outputChannel.appendLine('skopeo export complete.');
}

async function exportWithDockerSave(reference: string, outputDir: string): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oci-export-'));

  try {
    const tarPath = path.join(tempDir, 'image.tar');
    const extractDir = path.join(tempDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    outputChannel.appendLine(`Saving ${reference} with docker save…`);
    outputChannel.show(true);
    await spawnWithOutput('docker', ['save', reference, '-o', tarPath]);
    outputChannel.appendLine('Extracting tar…');
    await spawnWithOutput('tar', ['xf', tarPath, '-C', extractDir]);
    outputChannel.appendLine('Converting to OCI layout…');
    await convertDockerSaveToOci(extractDir, outputDir, reference);
    writeExportMetadata(outputDir, reference, 'docker-save');
    outputChannel.appendLine('Conversion complete.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function convertDockerSaveToOci(
  extractDir: string,
  outputDir: string,
  reference: string
): Promise<void> {
  const manifestPath = path.join(extractDir, 'manifest.json');
  const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as DockerManifestEntry[];

  if (manifestJson.length === 0) {
    throw new Error('Docker save produced an empty manifest.');
  }

  const blobsDir = path.join(outputDir, 'blobs', 'sha256');
  fs.mkdirSync(blobsDir, { recursive: true });

  fs.writeFileSync(
    path.join(outputDir, 'oci-layout'),
    JSON.stringify({ imageLayoutVersion: '1.0.0' })
  );

  const indexManifests: Array<{
    mediaType: string;
    digest: string;
    size: number;
    annotations?: Record<string, string>;
  }> = [];

  for (const entry of manifestJson) {
    const configContent = fs.readFileSync(path.join(extractDir, entry.Config));
    const configHash = computeBufferHash(configContent);
    fs.writeFileSync(path.join(blobsDir, configHash.digest), configContent);

    const layerDescriptors: Array<{ mediaType: string; digest: string; size: number }> = [];

    for (const layerRelPath of entry.Layers) {
      const layerSrcPath = path.join(extractDir, layerRelPath);
      const layerHash = await computeFileHash(layerSrcPath);
      fs.copyFileSync(layerSrcPath, path.join(blobsDir, layerHash.digest));

      layerDescriptors.push({
        mediaType: 'application/vnd.oci.image.layer.v1.tar',
        digest: `sha256:${layerHash.digest}`,
        size: layerHash.size,
      });
    }

    const ociManifest = {
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        mediaType: 'application/vnd.oci.image.config.v1+json',
        digest: `sha256:${configHash.digest}`,
        size: configHash.size,
      },
      layers: layerDescriptors,
    };

    const manifestBuffer = Buffer.from(JSON.stringify(ociManifest, null, 2));
    const manifestHash = computeBufferHash(manifestBuffer);
    fs.writeFileSync(path.join(blobsDir, manifestHash.digest), manifestBuffer);

    const tag = entry.RepoTags && entry.RepoTags[0] ? entry.RepoTags[0] : reference;
    indexManifests.push({
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      digest: `sha256:${manifestHash.digest}`,
      size: manifestHash.size,
      annotations: { 'org.opencontainers.image.ref.name': tag },
    });
  }

  fs.writeFileSync(
    path.join(outputDir, 'index.json'),
    JSON.stringify(
      { schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: indexManifests },
      null,
      2
    )
  );
}

export async function exportImageToOciLayout(reference: string): Promise<string> {
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

  const hasSkopeo = await isCommandAvailable('skopeo');
  if (hasSkopeo) {
    await exportWithSkopeo(reference, outputDir);
  } else {
    await exportWithDockerSave(reference, outputDir);
  }

  return outputDir;
}
