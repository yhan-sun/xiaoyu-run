import type { ReactNode } from "react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { IconArrowRight, IconCheck, IconLock } from "../ui/icons";

interface ReadyCardProps {
  placeCount: number;
  onGoRun: () => void;
}

export function ReadyCard({ placeCount, onGoRun }: ReadyCardProps) {
  return (
    <Card className="guide-card ready-card" padded={false}>
      <div className="ready-card-body">
        <div className="ready-mark" aria-hidden><IconCheck size={18} /></div>
        <div className="ready-copy">
          <div className="ready-title">准备就绪</div>
          <div className="ready-desc">{placeCount} 个场地可用</div>
        </div>
        <Button variant="primary" size="md" trailing={<IconArrowRight size={16} />} onClick={onGoRun}>
          去运动
        </Button>
      </div>
    </Card>
  );
}

export function GuideHelp({ isPhone }: { isPhone: boolean }) {
  return (
    <Card className="guide-help" padded={false}>
      <details className="help-details">
        <summary>
          <span className="help-summary-copy">
            <span className="help-summary-title">第一次使用？</span>
            <span className="help-summary-desc">取码 → 填入 → 同步 → 到场开跑</span>
          </span>
          <span className="help-chevron" aria-hidden>
            <IconArrowRight size={16} />
          </span>
        </summary>
        <ol className="help-steps">
          <li>
            <b>在电脑上取码</b>
            <span>
              电脑微信里打开过一次「重邮智慧体育」并完成绑定，再运行取码工具。
            </span>
          </li>
          <li>
            <b>导入到手机</b>
            <span>扫码，或把 OpenID 粘贴到上面。只需一次，之后固定保存。</span>
          </li>
          <li>
            <b>同步场地</b>
            <span>点「保存并同步场地」，拉取操场围栏与配速规则。</span>
          </li>
          <li>
            <b>到操场开跑</b>
            <span>
              开始后保持应用在前台，本人到摄像头下刷脸。跑满目标距离自动结算。
            </span>
          </li>
        </ol>
      </details>

      <details className="help-details">
        <summary>
          <span className="help-summary-copy">
            <span className="help-summary-title">关于人脸核验</span>
            <span className="help-summary-desc">工具不参与，也无法绕开</span>
          </span>
          <span className="help-chevron" aria-hidden>
            <IconArrowRight size={16} />
          </span>
        </summary>
        <p className="help-paragraph">
          人脸核验发生在操场摄像头侧，本工具不采集、不上传人脸数据。必须本人到场完成核验，
          否则记录可能被判无效。
        </p>
      </details>

      <details className="help-details">
        <summary>
          <span className="help-summary-copy">
            <span className="help-summary-title">本机与隐私</span>
            <span className="help-summary-desc">OpenID 默认遮盖，只保存在本机</span>
          </span>
          <span className="help-chevron" aria-hidden>
            <IconArrowRight size={16} />
          </span>
        </summary>
        <div className="help-paragraph">
          <p>
            OpenID 会保存在应用配置目录，界面默认只显示首尾。轨迹、配速和围栏判定全部在本地
            Rust 引擎完成。
          </p>
          <p className="help-inline">
            <IconLock size={14} />
            {isPhone
              ? "手机端无法自行读取微信缓存；取码只能在电脑上完成。"
              : "macOS 读取其他应用缓存需要「完全磁盘访问权限」。"}
          </p>
        </div>
      </details>
    </Card>
  );
}

export function GuideFootnote({ children }: { children: ReactNode }) {
  return <div className="guide-footnote">{children}</div>;
}
