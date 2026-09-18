import { defineConfig } from 'vitest/config';
import ts from 'typescript';
export default defineConfig({
  plugins: [
    {
      name: 'nest-test-decorators',
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('.ts') || id.includes('node_modules')) return;
        return ts.transpileModule(code, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2023,
            module: ts.ModuleKind.ESNext,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            sourceMap: true,
          },
          fileName: id,
        }).outputText;
      },
    },
  ],
});
