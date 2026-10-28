/**
 * Senha legível só em movimento: o fundo é um chiado parado e as letras são o mesmo tipo de chiado, só que andando.
 * Quem olha vê as letras pelo movimento; um print guarda um quadro só, e nele letras e fundo são o mesmo ruído
 * aleatório, sem nada que as separe.
 */
export interface NoiseField {
  width: number;
  height: number;
  /** Chiado do fundo, fixo. */
  background: Uint8Array;
  /** Chiado das letras, que desce uma linha por quadro. */
  texture: Uint8Array;
}

/** Um ponto aceso (1) ou apagado (0) por célula, metade de cada, sem padrão. */
function noise(size: number, random: () => number) {
  const cells = new Uint8Array(size);
  for (let index = 0; index < size; index++) cells[index] = random() < 0.5 ? 1 : 0;
  return cells;
}

export function createNoiseField(width: number, height: number, random: () => number = Math.random): NoiseField {
  return { width, height, background: noise(width * height, random), texture: noise(width * height, random) };
}

/** Quadro `offset`: dentro da máscara das letras, o chiado deslocado; fora dela, o fundo parado. */
export function noiseFrame(field: NoiseField, mask: Uint8Array, offset: number, out = new Uint8Array(field.width * field.height)) {
  const { width, height, background, texture } = field;
  const shift = ((offset % height) + height) % height;
  for (let y = 0; y < height; y++) {
    const source = ((y - shift + height) % height) * width;
    const row = y * width;
    for (let x = 0; x < width; x++) out[row + x] = mask[row + x] ? texture[source + x]! : background[row + x]!;
  }
  return out;
}
