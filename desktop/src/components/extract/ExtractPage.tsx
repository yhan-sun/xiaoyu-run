import type { ExtractResult, FoundOpenid } from "../../api";
import { maskOpenid } from "../../lib/format";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { toast } from "../ui/toast";
import {
  IconCopy,
  IconLock,
  IconQr,
  IconScan,
  IconShield,
} from "../ui/icons";

interface ExtractPageProps {
  extract: ExtractResult | null;
  busy: boolean;
  platform?: string;
  onExtract: () => void;
  onOpenPrivacy: () => void;
}

function copy(value: string) {
  void navigator.clipboard.writeText(value).then(
    () => toast.success("已复制 OpenID"),
    () => toast.error("复制失败")
  );
}

export function ExtractPage({
  extract,
  busy,
  platform,
  onExtract,
  onOpenPrivacy,
}: ExtractPageProps) {
  const primary =
    extract?.found.find((f) => f.cqupt) ?? extract?.found[0] ?? null;
  const others = extract?.found ?? [];

  return (
    <div className="page extract-page">
      <div className="extract-hero">
        <div className="extract-hero-copy">
          <div className="page-eyebrow">本机取码</div>
          <h1 className="t-large extract-title">从电脑微信拿到 OpenID</h1>
          <p className="extract-desc">
            手机端读不到微信的应用私有目录。电脑版微信的小程序缓存是明文，
            所以只需要在电脑上取一次，再扫码或手动填入手机。
          </p>
          <div className="extract-actions">
            <Button
              variant="primary"
              size="lg"
              icon={<IconScan size={18} />}
              loading={busy}
              onClick={onExtract}
            >
              扫描本机微信
            </Button>
            {platform === "macos" ? (
              <Button
                variant="secondary"
                size="lg"
                icon={<IconLock size={17} />}
                onClick={onOpenPrivacy}
              >
                完全磁盘访问
              </Button>
            ) : null}
          </div>
          {extract ? (
            <div className="extract-scan-meta num">
              扫描 {extract.scannedDirs} 个目录 · {extract.scannedFiles} 个文件
              {extract.deniedDirs > 0 ? ` · ${extract.deniedDirs} 个目录无权限` : ""}
            </div>
          ) : null}
        </div>

        <div className="extract-qr-card">
          <div className="extract-qr-frame">
            {extract?.qr ? (
              <div
                className="extract-qr"
                dangerouslySetInnerHTML={{ __html: extract.qr }}
              />
            ) : (
              <div className="extract-qr-empty">
                <IconQr size={34} />
                <span>尚未取到身份</span>
              </div>
            )}
            <span className="qr-corner qr-corner--tl" aria-hidden />
            <span className="qr-corner qr-corner--tr" aria-hidden />
            <span className="qr-corner qr-corner--bl" aria-hidden />
            <span className="qr-corner qr-corner--br" aria-hidden />
          </div>
          <div className="extract-qr-caption">
            <span className="t-label">扫码导入到手机</span>
            <span className="extract-qr-sub">
              {primary ? "在小雨run 指南页点击「扫码导入」" : "扫描后自动生成"}
            </span>
          </div>
        </div>
      </div>

      <div className="extract-grid">
        <section className="extract-section">
          <div className="section-head">
            <div className="section-head-copy">
              <div className="section-eyebrow">识别结果</div>
              <h2 className="t-section">本机微信身份</h2>
              <p className="section-desc">
                {others.length
                  ? `找到 ${others.length} 个候选，优先显示重邮绑定`
                  : "读取微信小程序缓存后显示"}
              </p>
            </div>
          </div>
          <Card className="extract-list-card" padded={false}>
            {primary ? (
              <div className="extract-primary">
                <div className="extract-primary-main">
                  <span className="extract-primary-label">OpenID</span>
                  <span className="extract-primary-value mono">
                    {maskOpenid(primary.openid)}
                  </span>
                  <span className="extract-primary-source">
                    {primary.cqupt ? "重邮智慧体育" : "微信身份"} · {primary.source}
                  </span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<IconCopy size={15} />}
                  onClick={() => copy(primary.openid)}
                >
                  复制
                </Button>
              </div>
            ) : (
              <EmptyState
                compact
                icon={<IconQr size={26} />}
                title="还没有识别到 OpenID"
                description="点上方「扫描本机微信」，或在电脑微信里打开一次「重邮智慧体育」再试。"
              />
            )}

            {others.length > 1 ? (
              <div className="extract-others">
                {others
                  .filter((f) => f.openid !== primary?.openid)
                  .map((f: FoundOpenid) => (
                    <div className="extract-other" key={`${f.openid}-${f.source}`}>
                      <span className="extract-other-main">
                        <span className="mono">{maskOpenid(f.openid)}</span>
                        <span className="extract-other-sub">
                          {f.cqupt ? "重邮" : "其他"} · {f.source}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="复制这个 OpenID"
                        onClick={() => copy(f.openid)}
                      >
                        <IconCopy size={16} />
                      </button>
                    </div>
                  ))}
              </div>
            ) : null}
          </Card>
        </section>

        <section className="extract-section">
          <div className="section-head">
            <div className="section-head-copy">
              <div className="section-eyebrow">权限</div>
              <h2 className="t-section">读不到数据时</h2>
              <p className="section-desc">缓存位于其他应用的沙箱容器</p>
            </div>
          </div>
          <Card className="extract-note-card" padded={false}>
            <div className="extract-note">
              <span className="extract-note-icon">
                <IconShield size={18} />
              </span>
              <div>
                <div className="extract-note-title">macOS 需要完全磁盘访问</div>
                <p>
                  系统设置 → 隐私与安全性 → 完全磁盘访问权限，勾选小雨run，
                  再回来重新扫描。读取别的应用的沙箱容器必须给这个权限。
                </p>
              </div>
            </div>
            <div className="extract-note">
              <span className="extract-note-icon">
                <IconLock size={18} />
              </span>
              <div>
                <div className="extract-note-title">手机端不参与取码</div>
                <p>
                  微信把小程序数据放在 Android 应用私有目录，未 root 无法读取。
                  请把 OpenID 发到手机，或直接扫上面的二维码。
                </p>
              </div>
            </div>
            <div className="extract-note extract-note--last">
              <div>
                <div className="extract-note-title">提取提示</div>
                <p>{extract?.note ?? "先在本机微信中打开一次「重邮智慧体育」小程序。"}</p>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
