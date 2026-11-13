import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Area } from "../../api";
import { IconCheck, IconChevronDown, IconClose, IconPin, IconSync } from "../ui/icons";
import { Button } from "../ui/Button";

interface PlaceSelectProps {
  areas: Area[];
  value: string;
  onChange: (value: string) => void;
  onSync: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function PlaceSelect({
  areas,
  value,
  onChange,
  onSync,
  disabled = false,
  loading = false,
}: PlaceSelectProps) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = areas.find((a) => a.placeCode === value);

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 20);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(
        '[role="option"][aria-selected="true"]'
      );
      el?.focus();
    }, 40);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={"place-select" + (selected ? "" : " is-empty")}
        disabled={disabled || loading}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="place-select-icon">
          <IconPin size={18} />
        </span>
        <span className="place-select-copy">
          <span className="place-select-name">
            {selected?.placeName ?? (loading ? "同步中…" : "尚未同步场地")}
          </span>
          <span className="place-select-sub">
            {selected
              ? `${selected.placeCode}${selected.banCount > 0 ? ` · ${selected.banCount} 处禁跑区` : " · 围栏已同步"}`
              : "先完成身份配置，再同步可用场地"}
          </span>
        </span>
        <span className="place-select-chevron" aria-hidden>
          <IconChevronDown size={17} />
        </span>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="selector-layer"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              <button
                type="button"
                tabIndex={-1}
                className="selector-backdrop"
                aria-label="关闭场地选择"
                onClick={close}
              />
              <motion.div
                ref={panelRef}
                className="selector-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                initial={reduced ? false : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 420, damping: 36, mass: 0.8 }
                }
              >
                <div className="selector-head">
                  <div>
                    <div className="selector-kicker">场地</div>
                    <h3 className="selector-title" id={titleId}>
                      选择本次跑步场地
                    </h3>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="关闭"
                    onClick={close}
                  >
                    <IconClose size={18} />
                  </button>
                </div>

                {areas.length === 0 ? (
                  <div className="selector-empty">
                    <p>还没有同步到场地。配置好 OpenID 后拉取操场围栏与规则。</p>
                    <Button
                      variant="primary"
                      full
                      icon={<IconSync size={17} />}
                      onClick={() => {
                        close();
                        onSync();
                      }}
                    >
                      去同步场地
                    </Button>
                  </div>
                ) : (
                  <div className="selector-list" role="listbox" aria-label="可用场地">
                    {areas.map((area) => {
                      const active = area.placeCode === value;
                      return (
                        <button
                          key={area.placeCode}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={"selector-option" + (active ? " is-active" : "")}
                          onClick={() => {
                            onChange(area.placeCode);
                            close();
                          }}
                        >
                          <span className="selector-option-main">
                            <span className="selector-option-name">{area.placeName}</span>
                            <span className="selector-option-sub">
                              {area.placeCode}
                              {area.banCount > 0
                                ? ` · ${area.banCount} 处禁跑区`
                                : ` · ${area.fenceVertices} 个围栏点`}
                            </span>
                          </span>
                          {active ? (
                            <span className="selector-check">
                              <IconCheck size={16} />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
