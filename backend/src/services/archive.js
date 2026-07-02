import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createExtractorFromFile } from 'node-unrar-js';
import { config, supportedSourceExtensions } from '../config.js';

const textDecoder = new TextDecoder('utf-8', { fatal: false });

export async function extractUpload(uploadedFile) {
  const extension = path.extname(uploadedFile.originalname).toLowerCase();

  if (extension === '.zip') {
    return extractZip(uploadedFile.path);
  }

  if (extension === '.rar') {
    return extractRar(uploadedFile.path);
  }

  return readSingleSourceFile(uploadedFile);
}

async function extractZip(filePath) {
  const zip = new AdmZip(filePath);
  const files = [];
  let totalBytes = 0;

  for (const entry of zip.getEntries()) {
    if (files.length >= config.maxExtractedFiles) break;
    if (entry.isDirectory) continue;
    if (!isSafeArchivePath(entry.entryName)) continue;
    if (!isSupportedSourceFile(entry.entryName)) continue;
    if (entry.header.size > config.maxExtractedFileBytes) continue;
    if (totalBytes + entry.header.size > config.maxTotalExtractedBytes) break;

    const buffer = entry.getData();
    if (buffer.length > config.maxExtractedFileBytes) continue;
    if (totalBytes + buffer.length > config.maxTotalExtractedBytes) break;
    totalBytes += buffer.length;
    files.push(makeExtractedFile(entry.entryName, buffer));
  }

  return files;
}

async function extractRar(filePath) {
  const targetPath = await fs.mkdtemp(path.join(os.tmpdir(), 'source-code-checker-rar-'));

  try {
    const extractor = await createExtractorFromFile({
      filepath: filePath,
      targetPath,
    });
    extractor.extract();
    const files = await walkExtractedDirectory(targetPath);
    return files.slice(0, config.maxExtractedFiles);
  } finally {
    await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
  }
}

async function walkExtractedDirectory(rootDir) {
  const results = [];
  const stack = [rootDir];
  let totalBytes = 0;

  while (stack.length && results.length < config.maxExtractedFiles) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(rootDir, absolutePath);
      if (!isSafeArchivePath(relativePath)) continue;

      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile() || !isSupportedSourceFile(relativePath)) continue;
      const stat = await fs.stat(absolutePath);
      if (stat.size > config.maxExtractedFileBytes) continue;
      if (totalBytes + stat.size > config.maxTotalExtractedBytes) return results;

      const buffer = await fs.readFile(absolutePath);
      totalBytes += buffer.length;
      results.push(makeExtractedFile(relativePath, buffer));
    }
  }

  return results;
}

async function readSingleSourceFile(uploadedFile) {
  if (!isSupportedSourceFile(uploadedFile.originalname)) {
    throw new Error('Unsupported source file.');
  }

  const stat = await fs.stat(uploadedFile.path);
  if (stat.size > config.maxExtractedFileBytes) {
    throw new Error('Source file exceeds per-file analysis limit.');
  }
  if (stat.size > config.maxTotalExtractedBytes) {
    throw new Error('Source file exceeds total analysis limit.');
  }

  const buffer = await fs.readFile(uploadedFile.path);
  return [makeExtractedFile(safeSingleFileName(uploadedFile.originalname), buffer)];
}

function makeExtractedFile(filePath, buffer) {
  const normalizedPath = filePath.replaceAll('\\', '/');
  const extension = path.extname(normalizedPath).toLowerCase();
  const text = textDecoder.decode(buffer);

  return {
    filePath: normalizedPath,
    language: supportedSourceExtensions.get(extension) || 'Unknown',
    rawText: text,
    sizeBytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

function isSupportedSourceFile(filePath) {
  return supportedSourceExtensions.has(path.extname(filePath).toLowerCase());
}

function isSafeArchivePath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return false;
  return !normalized.split('/').some((segment) => segment === '..' || segment === '');
}

function safeSingleFileName(fileName) {
  return path.basename(String(fileName || 'source.txt').replaceAll('\\', '/')) || 'source.txt';
}
