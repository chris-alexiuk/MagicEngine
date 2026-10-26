import type { CardDef, KeywordInstance } from '@mtg/schema';
import { annotateOracle } from '@mtg/schema';
import { useEffect, useState } from 'react';
import { AUTOMATION_HINT, AUTOMATION_LABEL, AutomationMark, CardImage, ManaCost, RulesText } from './bits';

const FORMAT_NAMES: [string, string][] = [
  ['commander', 'Commander'],
  ['standard', 'Standard'],
  ['pioneer', 'Pioneer'],
  ['modern', 'Modern'],
  ['legacy', 'Legacy'],
  ['vintage', 'Vintage'],
  ['pauper', 'Pauper'],
];
const LEGALITY_WORD = { l: 'Legal', r: 'Restricted', b: 'Banned' } as const;

function keywordLabel(k: KeywordInstance): string {
  const name = k.id.replace(/_/g, ' ');
  const head = name.charAt(0).toUpperCase() + name.slice(1);
  if (k.n !== undefined) return `${head} ${k.n}`;
  if (k.text && k.cost) return `${k.text} ${name} ${k.cost}`; // typecycling
  if (k.text) return `${head} ${k.text}`;
  if (k.cost) return `${head} ${k.cost}`;
  return head;
}

export function CardDetail({ card, onClose }: { card: CardDef; onClose: () => void }) {
  const [faceIndex, setFaceIndex] = useState(0);
  useEffect(() => setFaceIndex(0), [card.id]);
  const face = card.faces[faceIndex] ?? card.faces[0]!;
  const lines = annotateOracle(face);
  const stat = face.power !== undefined ? `${face.power}/${face.toughness}` : face.loyalty ?? face.defense;
  const statLabel = face.power !== undefined ? 'Power/toughness' : face.loyalty ? 'Loyalty' : 'Defense';
  const hasManual = lines.some((l) => l.status === 'manual');

  return (
    <article className="detail" aria-labelledby="detail-name">
      <button type="button" className="detail-close" onClick={onClose}>
        Close
      </button>

      {card.faces.length > 1 && (
        <div className="faces" role="tablist" aria-label="Card faces">
          {card.faces.map((f, i) => (
            <button
              key={f.name}
              type="button"
              role="tab"
              aria-selected={i === faceIndex}
              className={i === faceIndex ? 'face-tab active' : 'face-tab'}
              onClick={() => setFaceIndex(i)}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      <div className="detail-image">
        <CardImage card={card} faceIndex={faceIndex} sizes="(max-width: 860px) 70vw, 320px" eager />
      </div>

      <header className="detail-head">
        <h2 id="detail-name">{face.name}</h2>
        <ManaCost cost={face.manaCost} />
      </header>
      <p className="detail-type">{face.typeLine}</p>

      <div className={`detail-status status-${card.automation}`}>
        <AutomationMark level={card.automation} size={14} />
        <div>
          <strong>{AUTOMATION_LABEL[card.automation]}</strong>
          <span>{AUTOMATION_HINT[card.automation]}</span>
        </div>
      </div>

      {lines.length > 0 && (
        <div className="oracle">
          {lines.map((l, i) => (
            <p key={i} className={`oracle-line line-${l.status}`}>
              <RulesText text={l.text} />
            </p>
          ))}
          {hasManual && (
            <p className="oracle-legend">
              <span className="legend-swatch line-auto" /> Engine runs it
              <span className="legend-swatch line-manual" /> You resolve it
            </p>
          )}
        </div>
      )}

      {stat && (
        <p className="detail-stat">
          <span>{statLabel}</span> <strong>{stat}</strong>
        </p>
      )}

      {face.keywords.length > 0 && (
        <section className="detail-section">
          <h3>Keywords the engine recognises</h3>
          <ul className="chips">
            {face.keywords.map((k, i) => (
              <li key={i}>{keywordLabel(k)}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="detail-section">
        <h3>Formats</h3>
        <dl className="formats">
          {FORMAT_NAMES.map(([id, label]) => {
            const code = card.legal[id];
            return (
              <div key={id} className={code ? `fmt fmt-${code}` : 'fmt fmt-n'}>
                <dt>{label}</dt>
                <dd>{code ? LEGALITY_WORD[code] : 'Not legal'}</dd>
              </div>
            );
          })}
        </dl>
        {card.gameChanger && <p className="gc">On the Commander Game Changers list.</p>}
      </section>

      <p className="detail-foot">
        {card.set.toUpperCase()} {card.rarity}
      </p>
    </article>
  );
}
