import cbor from "cbor";

// cbor@9 `cbor.encode()` drains its Encoder with pipe() + NoFilter.read(); on Node 26 Readable.read() returns only the
// first buffered chunk (a 1-byte buffer for a tagged value). Read the encoder's whole buffer by length instead.
// The huge high-water mark keeps push() from returning false, which would stop cbor's `&&` push chains early
// (silent truncation of values larger than the default 16 KiB).
export const encodeCbor = (value, options) => {
  const encoder = new cbor.Encoder({ ...options, highWaterMark: 2 ** 30 });
  encoder.pushAny(value);
  encoder.end();
  return encoder.readableLength ? encoder.read(encoder.readableLength) : Buffer.alloc(0);
};
