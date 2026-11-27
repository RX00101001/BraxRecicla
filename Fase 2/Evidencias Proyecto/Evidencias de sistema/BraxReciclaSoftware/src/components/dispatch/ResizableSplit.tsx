'use client';

import { useRef, useState, type ReactNode, type PointerEvent } from 'react';
import styles from './dispatch.module.css';

export default function ResizableSplit({ first, second, vertical = false, initial = 50, label }: {
  first: ReactNode; second: ReactNode; vertical?: boolean; initial?: number; label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(initial);
  const drag = useRef(false);
  const update = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !container.current) return;
    const box = container.current.getBoundingClientRect();
    const value = vertical ? (event.clientY - box.top) / box.height : (event.clientX - box.left) / box.width;
    setRatio(Math.max(15, Math.min(85, value * 100)));
  };
  return <div ref={container} className={`${styles.split} ${vertical ? styles.vertical : ''}`}>
    <div className={styles.pane} style={{ flex: `0 0 calc(${ratio}% - 4px)` }}>{first}</div>
    <div role="separator" aria-label={label} aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(ratio)}
      tabIndex={0} className={styles.resize}
      onPointerDown={event => { drag.current = true; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
      onPointerMove={update} onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
      onKeyDown={event => {
        const keys = vertical ? ['ArrowUp','ArrowDown'] : ['ArrowLeft','ArrowRight'];
        if (keys.includes(event.key)) { event.preventDefault(); setRatio(value => Math.max(15,Math.min(85,value + (event.key === keys[0] ? -3 : 3)))); }
        if (event.key === 'Home') setRatio(initial);
      }}><span /></div>
    <div className={styles.pane} style={{ flex: '1 1 0' }}>{second}</div>
  </div>;
}
