#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const SUPPORTED_LANGUAGES = ['en', 'it'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IGNORED_DIRECTORIES = new Set(['.git', 'dist', 'docs', 'node_modules', 'server']);

const flattenKeys = (value, prefix = '', output = new Set()) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return output;
  }

  for (const [key, nested] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      flattenKeys(nested, nextPrefix, output);
    } else {
      output.add(nextPrefix);
    }
  }

  return output;
};

const loadLocaleNamespaces = () => {
  const namespacesByLanguage = new Map();

  for (const language of SUPPORTED_LANGUAGES) {
    const languageDir = path.join(ROOT_DIR, 'locales', language);
    const namespaceFiles = readdirSync(languageDir).filter((fileName) =>
      fileName.endsWith('.json'),
    );

    const namespaces = new Map();
    for (const fileName of namespaceFiles) {
      const namespace = fileName.replace(/\.json$/u, '');
      const localePath = path.join(languageDir, fileName);
      const localeJson = JSON.parse(readFileSync(localePath, 'utf8'));
      namespaces.set(namespace, flattenKeys(localeJson));
    }

    const commonJsonPath = path.join(languageDir, 'common.json');
    const commonJson = JSON.parse(readFileSync(commonJsonPath, 'utf8'));
    namespaces.set('form', flattenKeys(commonJson.form ?? {}));

    namespacesByLanguage.set(language, namespaces);
  }

  return namespacesByLanguage;
};

const collectSourceFiles = (directory) => {
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
};

const inferDefaultNamespace = (source) => {
  const useTranslationPattern = /useTranslation\s*\(\s*([^)]*)\)/gu;
  let match = useTranslationPattern.exec(source);
  while (match) {
    const args = match[1]?.trim() ?? '';

    if (args.length === 0) {
      return 'common';
    }

    if (args.startsWith('[')) {
      const namespaces = [...args.matchAll(/['"]([^'"]+)['"]/gu)].map((item) => item[1]);
      if (namespaces.length > 0) {
        return namespaces[0];
      }
    } else {
      const directNamespace = args.match(/^\s*['"]([^'"]+)['"]/u);
      if (directNamespace?.[1]) {
        return directNamespace[1];
      }
    }

    match = useTranslationPattern.exec(source);
  }

  return 'common';
};

const findLineNumber = (source, index) => {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '\n') {
      line += 1;
    }
  }
  return line;
};

const validateTranslations = (files, namespacesByLanguage) => {
  const errors = [];
  const translationCallPattern = /\bt\(\s*(['"`])([^'"`]+)\1/gu;

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf8');
    const defaultNamespace = inferDefaultNamespace(source);
    let match = translationCallPattern.exec(source);

    while (match) {
      const fullKey = match[2];
      if (fullKey.includes('${')) {
        match = translationCallPattern.exec(source);
        continue;
      }

      const separatorIndex = fullKey.indexOf(':');
      const namespace = separatorIndex > 0 ? fullKey.slice(0, separatorIndex) : defaultNamespace;
      const translationKey = separatorIndex > 0 ? fullKey.slice(separatorIndex + 1) : fullKey;

      const missingLanguages = [];
      for (const language of SUPPORTED_LANGUAGES) {
        const namespaces = namespacesByLanguage.get(language);
        const namespaceKeys = namespaces?.get(namespace);
        if (!namespaceKeys || !namespaceKeys.has(translationKey)) {
          missingLanguages.push(language);
        }
      }

      if (missingLanguages.length > 0) {
        errors.push({
          filePath,
          line: findLineNumber(source, match.index),
          key: `${namespace}:${translationKey}`,
          missingLanguages,
        });
      }

      match = translationCallPattern.exec(source);
    }
  }

  return errors;
};

const main = () => {
  const namespacesByLanguage = loadLocaleNamespaces();
  const files = collectSourceFiles(ROOT_DIR);
  const errors = validateTranslations(files, namespacesByLanguage);

  if (errors.length === 0) {
    console.log('i18n check passed: no missing translation keys.');
    return;
  }

  errors.sort((left, right) => {
    if (left.filePath !== right.filePath) {
      return left.filePath.localeCompare(right.filePath);
    }
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    return left.key.localeCompare(right.key);
  });

  console.error(`i18n check failed: ${errors.length} missing translation reference(s).`);
  for (const error of errors) {
    const relativePath = path.relative(ROOT_DIR, error.filePath);
    console.error(
      `- ${relativePath}:${error.line} -> ${error.key} missing [${error.missingLanguages.join(', ')}]`,
    );
  }

  process.exit(1);
};

main();
