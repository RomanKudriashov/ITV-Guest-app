import { Fragment, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export interface InfoContentProps {
  content: string;
  testId?: string;
}

/**
 * A deliberately tiny markup renderer for an `info` page — no heavy markdown
 * library, just the handful of shapes a hotel actually writes: headings (`#`,
 * `##`), bullet lists (`-`/`*`), paragraphs, blank-line breaks and inline
 * `**bold**`. Anything it does not recognise is shown verbatim as text, so a
 * page never renders raw asterisks in a way that hides information.
 */
export function InfoContent({ content, testId }: InfoContentProps) {
  const blocks = toBlocks(content);
  return (
    <Box data-testid={testId} sx={{ '& > * + *': { mt: 1 } }}>
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block)}</Fragment>
      ))}
    </Box>
  );
}

interface Block {
  kind: 'h1' | 'h2' | 'p' | 'ul';
  lines: string[];
}

function toBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let list: string[] | null = null;

  const flushList = () => {
    if (list && list.length) blocks.push({ kind: 'ul', lines: list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      blocks.push({ kind: 'h2', lines: [trimmed.slice(3)] });
    } else if (trimmed.startsWith('# ')) {
      flushList();
      blocks.push({ kind: 'h1', lines: [trimmed.slice(2)] });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!list) list = [];
      list.push(trimmed.slice(2));
    } else {
      flushList();
      blocks.push({ kind: 'p', lines: [trimmed] });
    }
  }
  flushList();
  return blocks;
}

function renderBlock(block: Block): ReactNode {
  switch (block.kind) {
    case 'h1':
      return (
        <Typography variant="h6" component="h2">
          {inline(block.lines[0])}
        </Typography>
      );
    case 'h2':
      return (
        <Typography variant="subtitle1" component="h3">
          {inline(block.lines[0])}
        </Typography>
      );
    case 'ul':
      return (
        <Box component="ul" sx={{ pl: 3, m: 0 }}>
          {block.lines.map((item, index) => (
            <Typography key={index} component="li" variant="body2" color="text.secondary">
              {inline(item)}
            </Typography>
          ))}
        </Box>
      );
    default:
      return (
        <Typography variant="body2" color="text.secondary">
          {inline(block.lines[0])}
        </Typography>
      );
  }
}

/** Splits on `**bold**`, keeping the plain runs between the emphasised ones. */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <Box key={index} component="strong" sx={{ color: 'text.primary', fontWeight: 700 }}>
        {part.slice(2, -2)}
      </Box>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
