const tsJest = require('ts-jest').default;

const transformer = tsJest.createTransformer();

// Vite normally replaces these two constants. The real Binding integration
// tests load these five extension modules through Jest's CommonJS runtime, so
// replace only their exact expressions before ts-jest creates its source map.
const viteEnvironmentFiles = [
    '/extension/src/services/build-flags.ts',
    '/extension/src/services/i18n.ts',
    '/extension/src/services/localization-fetcher.ts',
    '/extension/src/ui/hooks/use-i18n.ts',
    '/extension/src/ui/i18n.ts',
];

const replaceViteEnvironment = (sourceText, sourcePath) => {
    const normalizedSourcePath = sourcePath.replaceAll('\\', '/');
    if (!viteEnvironmentFiles.some((filePath) => normalizedSourcePath.endsWith(filePath))) {
        return sourceText;
    }

    return sourceText.replaceAll('import.meta.env.BROWSER', '""').replaceAll('import.meta.env.MODE', '"test"');
};

module.exports = {
    process(sourceText, sourcePath, options) {
        return transformer.process(replaceViteEnvironment(sourceText, sourcePath), sourcePath, options);
    },
};
