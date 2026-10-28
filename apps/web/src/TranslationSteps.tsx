import { useEffect, useRef } from 'react';

const STEPS = ['Modalidade e documentos', 'Identificação e protocolo', 'Idiomas e equipe', 'Conferência do envio'];

/**
 * Etapas da nova tradução. A cada troca de etapa a tela volta para o topo do formulário e a etapa atual recebe o foco:
 * ninguém precisa procurar onde a etapa começa.
 */
export function TranslationSteps({
  step,
  onChange,
  disabled = false,
}: {
  step: number;
  onChange: (step: number) => void;
  disabled?: boolean;
}) {
  const nav = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    const element = nav.current;
    if (!element) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    if (first.current) {
      first.current = false;
      return;
    }
    // O foco vai para a etapa atual (e não para um campo, que poderia abrir uma lista sozinho); Tab segue para os campos.
    element.querySelector<HTMLElement>('[aria-current="step"]')?.focus({ preventScroll: true });
  }, [step]);
  return (
    <>
      <nav ref={nav} className="translation-setup-steps doc-setup-steps" aria-label="Etapas da nova tradução">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            aria-current={index === step ? 'step' : undefined}
            disabled={disabled || index > step}
            onClick={() => onChange(index)}
          >
            <span>{index + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <p className="muted small-text doc-step-status" role="status">
        Etapa {step + 1} de {STEPS.length}: {STEPS[step]}
      </p>
    </>
  );
}

/** Contagem da etapa no rodapé fixo, ao lado dos botões. */
export const stepCount = (step: number) => `Etapa ${step + 1} de ${STEPS.length}`;
