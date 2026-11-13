import { useEffect, useState } from "react";
import { openidHint, sanitizeOpenid } from "../../api";
import { maskOpenid } from "../../lib/format";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { StatusIndicator } from "../ui/StatusIndicator";
import { toast } from "../ui/toast";
import {
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconQr,
  IconScan,
  IconSync,
  IconUpload,
} from "../ui/icons";

interface IdentityCardProps {
  openidText: string;
  verified: boolean;
  connecting: boolean;
  disabled: boolean;
  isPhone: boolean;
  onTextChange: (value: string) => void;
  onSave: () => void;
  onScan: () => void;
  onGoExtract: () => void;
  onCheckImport: () => void;
}

export function IdentityCard({
  openidText,
  verified,
  connecting,
  disabled,
  isPhone,
  onTextChange,
  onSave,
  onScan,
  onGoExtract,
  onCheckImport,
}: IdentityCardProps) {
  const [editing, setEditing] = useState(false);
  const [reveal, setReveal] = useState(false);
  const clean = sanitizeOpenid(openidText);
  const hint = openidHint(clean);

  useEffect(() => {
    if (verified) {
      setEditing(false);
      setReveal(false);
    }
  }, [verified]);

  const compact = verified && !editing;

  return (
    <Card className="guide-card" padded={false}>
      <div className="guide-card-head">
        <div className="guide-card-heading">
          <span className="guide-step-no num">01</span>
          <div>
            <h2 className="guide-card-title">身份</h2>
            <p className="guide-card-desc">从电脑版微信取一次 OpenID</p>
          </div>
        </div>
        <StatusIndicator
          tone={verified ? "success" : clean ? (hint.bad ? "danger" : "warning") : "neutral"}
          label={verified ? "已验证" : clean ? (hint.bad ? "格式异常" : "待验证") : "未配置"}
          size="sm"
          plain
        />
      </div>

      <div className="guide-card-body">
        {compact ? (
          <div className="identity-summary">
            <div className="identity-summary-mark" aria-hidden>
              <IconCheck size={18} />
            </div>
            <div className="identity-summary-copy">
              <span className="identity-summary-label">OpenID</span>
              <span className="identity-summary-value mono">
                {maskOpenid(clean)}
              </span>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="复制 OpenID"
              onClick={() => {
                void navigator.clipboard.writeText(clean).then(
                  () => toast.success("已复制 OpenID"),
                  () => toast.error("复制失败")
                );
              }}
            >
              <IconCopy size={18} />
            </button>
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => setEditing(true)}
            >
              更换
            </button>
          </div>
        ) : (
          <>
            <label className="openid-field">
              <span className="openid-label">OpenID</span>
              <span className="openid-input-wrap">
                <input
                  className="openid-input mono"
                  disabled={disabled}
                  value={openidText}
                  onChange={(event) => onTextChange(event.target.value)}
                  onBlur={() => onTextChange(clean)}
                  placeholder="粘贴 OpenID，或扫码导入"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  type={reveal ? "text" : "password"}
                  aria-label="OpenID"
                  aria-invalid={hint.bad || undefined}
                  autoFocus={editing}
                />
                <button
                  type="button"
                  className="icon-btn openid-action"
                  aria-label={reveal ? "隐藏 OpenID" : "显示 OpenID"}
                  onClick={() => setReveal((v) => !v)}
                >
                  {reveal ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                </button>
                {clean ? (
                  <button
                    type="button"
                    className="icon-btn openid-action"
                    aria-label="复制 OpenID"
                    onClick={() => {
                      void navigator.clipboard.writeText(clean).then(
                        () => toast.success("已复制 OpenID"),
                        () => toast.error("复制失败")
                      );
                    }}
                  >
                    <IconCopy size={18} />
                  </button>
                ) : null}
              </span>
            </label>

            <div className={"openid-hint" + (hint.bad ? " is-bad" : "")}>
              {hint.text ||
                "只需要填一次。敏感标识默认遮盖，仅保存在本机配置里。"}
            </div>

            <div className="guide-actions">
              <Button
                variant="primary"
                size="md"
                full
                loading={connecting}
                disabled={disabled || !clean || hint.bad}
                icon={<IconSync size={17} />}
                onClick={onSave}
              >
                保存并同步场地
              </Button>
              <div className="guide-action-row">
                <Button
                  variant="secondary"
                  size="md"
                  full
                  disabled={disabled}
                  icon={isPhone ? <IconScan size={17} /> : <IconQr size={17} />}
                  onClick={isPhone ? onScan : onGoExtract}
                >
                  {isPhone ? "扫码导入" : "本机微信提取"}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  full
                  disabled={disabled}
                  icon={<IconUpload size={16} />}
                  onClick={onCheckImport}
                >
                  检查电脑导入
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
