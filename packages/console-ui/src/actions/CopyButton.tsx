import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from './IconButton.js';

export interface CopyButtonProps {
  text: string;
  label?: string;
}

export function CopyButton({ text, label = 'Copy' }: CopyButtonProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={copied ? 'Copied' : label}
      variant="tertiary"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    />
  );
}
