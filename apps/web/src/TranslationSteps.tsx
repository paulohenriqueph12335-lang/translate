const STEPS = ['Documentos', 'Identificação e protocolo', 'Idiomas e modalidade', 'Conferência do envio'];

export function TranslationSteps({
  step,
  onChange,
  disabled = false,
}: {
  step: number;
  onChange: (step: number) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <nav className="translation-setup-steps doc-setup-steps" aria-label="Etapas da nova tradução">
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
