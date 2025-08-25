import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import globals from 'rollup-plugin-node-globals';

const external = [
  // Node built-ins:
  'node:util','util','node:stream','stream','path','fs','events','buffer','os','http','https','url','zlib','tty'
];

export default {
  input: './src/index.ts',
  external: external,
  output: [
    {
      dir: './dist',
      entryFileNames: 'esm/[name].js',
      format: 'esm',
      sourcemap: true,
    },
    {
      dir: './dist',
      entryFileNames: 'cjs/[name].js',
      format: 'cjs',
      sourcemap: true,
      plugins: [
        globals(), // Provides global variables for Node.js built-ins
      ]
    },
  ],
  plugins: [
    json(), // Allows importing JSON files
    resolve({
      exportConditions: ['node', 'default', 'module', 'import'],
      preferBuiltins: true,
      extensions: ['.js', '.mjs', '.ts', '.json'],
    }), // Resolves node_modules and relative paths
    commonjs(),// Converts CommonJS modules to ES6
    typescript({
      tsconfig: './tsconfig.json',
      declaration: true,
      declarationDir: './dist/types'
    }), // Handles TypeScript (if needed)
  ],
  onwarn(warning, warn) {
    // Print detailed warnings
    if (warning.code === 'THIS_IS_UNDEFINED') return;
    if (warning.code === 'SOURCEMAP_ERROR') return;
    if (warning.code === 'ANNOTATION') return;
    if (warning.code === 'UNRESOLVED_IMPORT') {
      throw new Error(warning.message);
    }
    warn(warning);
  },
};
