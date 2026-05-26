import * as fs from 'node:fs';
import * as path from 'node:path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 20000,
  });

  const testsRoot = __dirname;
  const files = fs
    .readdirSync(testsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
    .map((entry) => path.join(testsRoot, entry.name));

  for (const file of files) {
    mocha.addFile(file);
  }

  await new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} test${failures === 1 ? '' : 's'} failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
