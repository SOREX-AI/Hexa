import type { HexaBridge } from '../shared/types';
import type React from 'react';

declare global {
  interface Window {
    hexa: HexaBridge;
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string };
    }
  }
}
export {};
