'use client';

// Renders a single card. Faces come ONLY from the provided SVGs (CARD_ASSET /
// CARD_BACK_ASSET) — never redraw a card face. This component is a plain
// <img>, sized by its container via the `.card-img` CSS class (aspect-ratio
// 695/949 matches the source SVGs).

import { CARD_ASSET, CARD_BACK_ASSET, type CardName } from '@lazy-sunday/engine';

export function faceSrc(name: CardName): string {
  return `/cards/${CARD_ASSET[name]}`;
}

export const BACK_SRC = `/cards/${CARD_BACK_ASSET}`;

export function CardFace({
  name,
  className,
  alt,
}: {
  name: CardName;
  className?: string;
  alt?: string;
}) {
  return <img src={faceSrc(name)} alt={alt ?? name} className={`card-img ${className ?? ''}`} draggable={false} />;
}

export function CardBack({ className, alt = 'Face-down card' }: { className?: string; alt?: string }) {
  return <img src={BACK_SRC} alt={alt} className={`card-img ${className ?? ''}`} draggable={false} />;
}
