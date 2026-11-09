import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

@Injectable()
export class ObjectStorageService {
  private readonly driver: string;
  private readonly rootDirectory: string;
  private readonly bucket: string;
  private readonly s3?: S3Client;

  constructor(config: ConfigService) {
    this.driver = config.get('STORAGE_DRIVER', 'local');
    this.rootDirectory = resolve(config.get('PRIVATE_STORAGE_DIR', '.private-storage'));
    this.bucket = config.get('S3_BUCKET', '');

    if (this.driver === 's3') {
      if (!this.bucket) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
      this.s3 = new S3Client({
        region: config.get('S3_REGION', 'us-east-1'),
        endpoint: config.get<string | undefined>('S3_ENDPOINT'),
        forcePathStyle: Boolean(config.get('S3_ENDPOINT')),
      });
    } else if (this.driver !== 'local') {
      throw new Error('STORAGE_DRIVER must be either local or s3');
    }
  }

  async put(key: string, contents: Buffer): Promise<void> {
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: contents,
        ContentType: 'application/octet-stream',
        ServerSideEncryption: 'AES256',
      }));
      return;
    }

    const path = this.localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, { flag: 'wx', mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    if (this.s3) {
      const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) throw new InternalServerErrorException('Stored object has no body');
      return Buffer.from(await result.Body.transformToByteArray());
    }

    return readFile(this.localPath(key));
  }

  async exists(key: string): Promise<boolean> {
    if (this.s3) {
      try {
        await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        return true;
      } catch (error) {
        if (typeof error === 'object' && error !== null && '$metadata' in error) {
          const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
          if (statusCode === 404) return false;
        }
        throw error;
      }
    }

    try {
      const details = await stat(this.localPath(key));
      return details.isFile();
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      return;
    }

    await rm(this.localPath(key), { force: true });
  }

  private localPath(key: string): string {
    const path = resolve(this.rootDirectory, key);
    const pathFromRoot = relative(this.rootDirectory, path);
    if (!pathFromRoot || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
      throw new Error('Invalid storage key');
    }
    return path;
  }
}