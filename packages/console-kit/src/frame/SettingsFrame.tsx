import { Button } from '../actions/Button.js';
import { cx } from '../cx.js';
import { Icon } from '../data/Icon.js';

/** Search owns the dialog head, like VS Code — it filters rows across sections. */
export function DialogSearchHead({
  value,
  onChange,
  onClose,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  placeholder: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-2.5">
      <span className="text-body text-s7">⌕</span>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sec text-s11 outline-none placeholder:text-s6"
      />
      <Button
        variant="ghost"
        icon
        aria-label="Close Settings"
        onClick={onClose}
        className="-mr-1 h-6 w-6"
      >
        <Icon name="close" />
      </Button>
    </div>
  );
}

/** The TOC rail — while searching it reflects only sections that still match,
 *  and `activeId: null` (search mode) marks nothing. */
export function TocRail({
  entries,
  activeId,
  onJump,
}: {
  entries: { id: string; title: string }[];
  activeId: string | null;
  onJump: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="w-32 flex-none border-r border-s3 py-2">
      {entries.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onJump(s.id)}
          className={cx(
            'slip flex w-full cursor-pointer items-center px-4 py-[5px] text-left text-sec',
            s.id === activeId ? 'bg-s3 text-s12' : 'text-s10 hover:bg-s3 hover:text-s11',
          )}
        >
          {s.title}
        </button>
      ))}
    </div>
  );
}

/** One setting: name + description + an inline control. */
export function SettingRow({
  name,
  desc,
  children,
}: {
  name: string;
  desc: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sec text-s11">{name}</div>
        {/* 11px sits between text-code and text-meta — candidate seventh type token */}
        <div className="mt-0.5 text-[11px] leading-[1.4] text-s7">{desc}</div>
      </div>
      {children}
    </div>
  );
}
