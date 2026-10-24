import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { LANGUAGE_PAIRS } from './api';
import { languagePairTokens, searchLanguagePairs } from './language-pair-search';
import './LanguagePairPicker.css';

export interface LanguagePairPickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /** Opção vazia em filtros; omitir para exigir uma direção de tradução. */
  any?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Combobox editável com escolha explícita; o texto de pesquisa nunca vira um idioma arbitrário. */
export function LanguagePairPicker({
  value,
  onChange,
  label = 'Idiomas',
  any,
  required = any === undefined,
  disabled = false,
  id,
  className = '',
}: LanguagePairPickerProps) {
  const generated = useId();
  const inputId = id ?? `${generated}-pair`;
  const listId = `${generated}-options`,
    helpId = `${generated}-help`,
    resultId = `${generated}-results`;
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selected = LANGUAGE_PAIRS.find((pair) => pair.value === value);
  const selectedLabel = selected?.label ?? (value === '' ? (any ?? '') : '');
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const search = query === selectedLabel ? '' : query;
  const options = useMemo(() => {
    const pairs = searchLanguagePairs(search, LANGUAGE_PAIRS);
    const allMatches = any !== undefined && (!languagePairTokens(search).length || /^(todos?|qualquer)/i.test(search.trim()));
    return [...(allMatches ? [{ value: '', label: any! }] : []), ...pairs];
  }, [search, any]);
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    if (!open) setQuery(selectedLabel);
  }, [selectedLabel, open]);
  useEffect(() => {
    input.current?.setCustomValidity(required && !selected ? 'Selecione um par de idiomas válido na lista.' : '');
  }, [required, selected]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 8,
        above = rect.top - 8;
      const upward = below < 220 && above > below;
      const maxHeight = Math.min(320, Math.max(120, upward ? above : below));
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: upward ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector(`[id="${listId}-${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, listId]);

  function choose(next: string) {
    input.current?.focus();
    onChange(next);
    setOpen(false);
  }
  function close() {
    setOpen(false);
    setQuery(selectedLabel);
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(event.key === 'ArrowUp' ? Math.max(0, options.length - 1) : 0);
      } else if (options.length) setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option.value);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') close();
  }

  return (
    <div className={`language-pair-picker ${className}`}>
      <div className="language-pair-field">
        <input
          ref={input}
          id={inputId}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && options.length ? `${listId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-required={required}
          aria-describedby={helpId}
          required={required && !selected}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          placeholder="Digite FR ES ou o nome dos idiomas"
          value={open ? query : selectedLabel}
          onFocus={(event) => {
            setQuery(selectedLabel);
            setActive(
              Math.max(
                0,
                options.findIndex((option) => option.value === value),
              ),
            );
            setOpen(true);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onBlur={close}
          onKeyDown={keyDown}
          onInvalid={() => {
            setOpen(true);
            setQuery('');
            setActive(0);
          }}
        />
        {(value || query) && (
          <button
            type="button"
            className="pair-clear"
            aria-label={required ? `Limpar pesquisa de ${label.toLowerCase()}` : `Limpar ${label.toLowerCase()}`}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              input.current?.focus();
              // Formulários conservam a escolha obrigatória enquanto se refaz a pesquisa;
              // nos filtros, limpar remove também o par selecionado.
              if (!required) onChange('');
              setQuery('');
              setActive(0);
              setOpen(true);
            }}
          >
            ×
          </button>
        )}
        <button
          type="button"
          className="pair-open"
          tabIndex={-1}
          aria-label={`Mostrar opções de ${label.toLowerCase()}`}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) close();
            else {
              setQuery('');
              setActive(0);
              input.current?.focus();
              setOpen(true);
            }
          }}
        >
          ⌄
        </button>
      </div>
      <span id={helpId} className="pair-screenreader">
        Digite nomes ou siglas na ordem origem e destino. Use setas para navegar, Enter para selecionar e Escape para manter a escolha
        atual.
      </span>
      {open &&
        createPortal(
          <div className="language-pair-popup" style={position} onMouseDown={(event) => event.preventDefault()}>
            <div className="language-pair-hint">Origem → destino · ex.: FRA ESP</div>
            <ul ref={list} id={listId} role="listbox" aria-label={`Opções de ${label.toLowerCase()}`}>
              {options.map((option, index) => (
                <li
                  id={`${listId}-${index}`}
                  key={option.value}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={index === activeIndex ? 'active' : ''}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(option.value)}
                >
                  <span>{option.label}</span>
                  {option.value && <small>{option.value.toUpperCase().replace('-', ' → ')}</small>}
                </li>
              ))}
            </ul>
            <div id={resultId} className="language-pair-hint" role="status">
              {options.length
                ? `${options.length} ${options.length === 1 ? 'opção disponível' : 'opções disponíveis'}`
                : 'Nenhum par encontrado. Tente FR ES ou francês espanhol.'}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
