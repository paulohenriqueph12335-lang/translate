import { useEffect, useRef } from 'react';
import { createNoiseField, noiseFrame } from './password-noise';

/** Tamanho de cada ponto do chiado, em pixels da tela. */
const CELL = 2;
const FONT = '700 30px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const PADDING = 6;

/** Cor CSS (qualquer formato, inclusive tokens) em RGB, desenhando um pixel. */
function rgb(color: string): [number, number, number] {
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe) return [0, 0, 0];
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/** Máscara das letras, um valor por ponto: 1 onde o texto passa. */
function textMask(text: string) {
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  measure.font = FONT;
  const metrics = measure.measureText(text);
  const width = Math.ceil((metrics.width + PADDING * 2) / CELL);
  const height = Math.ceil((30 * 1.4 + PADDING) / CELL);
  const canvas = document.createElement('canvas');
  canvas.width = width * CELL;
  canvas.height = height * CELL;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.font = FONT;
  context.textBaseline = 'middle';
  context.fillStyle = '#000';
  context.fillText(text, PADDING, canvas.height / 2);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const alpha = pixels[((y * CELL + CELL / 2) * canvas.width + x * CELL + CELL / 2) * 4 + 3] ?? 0;
      mask[y * width + x] = alpha > 96 ? 1 : 0;
    }
  return { mask, width, height };
}

/**
 * A senha à mostra em pontos que se movem (ver password-noise.ts): legível na tela, chiado uniforme num print.
 * O texto nunca vai para a página como texto: só o desenho existe, e ele não é lido por leitores de tela.
 */
export function NoisyPassword({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    const shape = text ? textMask(text) : null;
    if (!canvas || !context || !shape) return;
    const { mask, width, height } = shape;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width * CELL}px`;
    canvas.style.height = `${height * CELL}px`;
    const style = getComputedStyle(canvas);
    const ink = rgb(style.color);
    const paper = rgb(style.backgroundColor === 'rgba(0, 0, 0, 0)' ? '#fff' : style.backgroundColor);
    const field = createNoiseField(width, height);
    const image = context.createImageData(width, height);
    const cells = new Uint8Array(width * height);
    let offset = 0;
    let frame = 0;
    const draw = () => {
      noiseFrame(field, mask, offset++, cells);
      for (let index = 0; index < cells.length; index++) {
        const [r, g, b] = cells[index] ? ink : paper;
        image.data[index * 4] = r;
        image.data[index * 4 + 1] = g;
        image.data[index * 4 + 2] = b;
        image.data[index * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [text]);
  if (!text) return null;
  return (
    <span className="password-noise" aria-hidden="true">
      <canvas ref={ref} />
    </span>
  );
}
