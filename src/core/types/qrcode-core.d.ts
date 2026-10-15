/**
 * Types for the pure QR encoder of `qrcode` (MIT, https://github.com/soldair/node-qrcode),
 * imported directly from its core so neither the canvas nor the PNG renderer is bundled.
 */
declare module 'qrcode/lib/core/qrcode.js' {
  export interface QrBitMatrix {
    size: number;
    /** 1 = dark module. Note the argument order: row (y), then column (x). */
    get(row: number, col: number): number;
    data: Uint8Array;
  }
  export interface QrCodeData {
    modules: QrBitMatrix;
    version: number;
    maskPattern: number;
  }
  const qrcodeCore: {
    create(
      text: string,
      options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'; version?: number },
    ): QrCodeData;
  };
  export default qrcodeCore;
}
