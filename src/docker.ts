import * as http from 'node:http';
import * as vscode from 'vscode';

export interface DockerImage {
  Id: string;
  ParentId: string;
  RepoTags: string[] | null;
  RepoDigests: string[] | null;
  Created: number;
  Size: number;
  Labels: Record<string, string> | null;
}

interface DockerConnectionOptions {
  socketPath?: string;
  hostname?: string;
  port?: number;
}

function parseDockerHost(dockerHost: string): DockerConnectionOptions {
  if (dockerHost.startsWith('unix://')) {
    return { socketPath: dockerHost.slice('unix://'.length) };
  }
  if (dockerHost.startsWith('tcp://')) {
    const url = new URL(dockerHost.replace('tcp://', 'http://'));
    return { hostname: url.hostname, port: parseInt(url.port, 10) || 2375 };
  }
  if (dockerHost.startsWith('npipe://')) {
    return { socketPath: dockerHost.slice('npipe://'.length).replace(/\//g, '\\') };
  }
  return { socketPath: dockerHost };
}

function getDefaultSocketPath(): string {
  return process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock';
}

function getConnectionOptions(): DockerConnectionOptions {
  const configuredPath = vscode.workspace.getConfiguration('ociExplorer.docker').get<string>('socketPath', '');
  if (configuredPath) {
    return { socketPath: configuredPath };
  }

  const dockerHost = process.env.DOCKER_HOST;
  if (dockerHost) {
    return parseDockerHost(dockerHost);
  }

  return { socketPath: getDefaultSocketPath() };
}

function dockerRequest(apiPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = getConnectionOptions();
    const options: http.RequestOptions = {
      path: apiPath,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    };

    if (conn.socketPath) {
      options.socketPath = conn.socketPath;
    } else {
      options.hostname = conn.hostname;
      options.port = conn.port;
    }

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Docker API returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        reject(new Error('Cannot connect to Docker daemon. Is Docker running?'));
      } else {
        reject(err);
      }
    });

    req.end();
  });
}

export async function listImages(): Promise<DockerImage[]> {
  const data = await dockerRequest('/images/json');
  return JSON.parse(data) as DockerImage[];
}

export async function ping(): Promise<boolean> {
  try {
    await dockerRequest('/_ping');
    return true;
  } catch {
    return false;
  }
}
