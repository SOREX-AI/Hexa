// TypeScript does not execute style imports; Vite owns CSS loading at runtime.
// This ambient declaration keeps strict renderer type-checking independent of Node types.
declare module '*.css';
