// ─────────────────────────────────────────────────────────────────────────────
// bee/parts.js — the selectable components: names, captions, label priority and
// when each one leaves in the exploded view (0 = first off, outermost).
// Long-form copy (function, biology fact) lives in data/partsCopy.js.
// ─────────────────────────────────────────────────────────────────────────────
import { SPEC } from '../core/state.js';

/** priority 0 = top-level label, 1 = detail (revealed on hover when dense). `n` = schematic callout number. */
export const PARTS = {
  forewings: { name: 'Forewings',            caption: `${SPEC.forewingMm} mm · etched glass`,        priority: 0, n: 4 },
  hindwings: { name: 'Hindwings',            caption: `${SPEC.hindwingMm} mm · etched glass`,        priority: 0, n: 5 },
  hamuli:    { name: 'Hamuli Coupling',      caption: `${SPEC.hamuli} hooks`,                        priority: 0 },
  eyes:      { name: 'Compound Eyes',        caption: `2 × ${SPEC.facetsPerEye} hex lenses`,         priority: 0, n: 1 },
  ocelli:    { name: 'Ocelli Triad',         caption: '3 jewel lenses',                              priority: 1 },
  antennae:  { name: 'Antennae',             caption: `scape · pedicel · ${SPEC.flagellomeres} flagellomeres`, priority: 0, n: 2 },
  mandibles: { name: 'Mandibles',            caption: 'paired · pin-hinged',                         priority: 1 },
  proboscis: { name: 'Proboscis',            caption: 'folding glossa',                              priority: 1 },
  cranium:   { name: 'Cranial Housing',      caption: 'glazed head capsule',                         priority: 0 },
  scutum:    { name: 'Scutum & Scutellum',   caption: 'dorsal plates · flexing',                     priority: 0, n: 3 },
  thoraxbox: { name: 'Thoracic Box',         caption: 'pleura & sternum',                            priority: 1 },
  motor:     { name: 'Resonant Flight Motor', caption: `sprung box · ${SPEC.beatHz} Hz`,             priority: 0 },
  geartrain: { name: 'Gear Train',           caption: `${SPEC.gearTeeth[3]} · ${SPEC.gearTeeth[2]} — ${SPEC.gearTeeth[1]} · ${SPEC.gearTeeth[0]} teeth`, priority: 1 },   // in drive order: barrel → crank
  hinges:    { name: 'Wing Hinge Assembly',  caption: 'universal joint · stroke + pitch',       priority: 1 },
  setae:     { name: 'Setae',                caption: '≈ 17,500 filaments',                          priority: 1 },
  forelegs:  { name: 'Fore Legs',            caption: 'antenna-cleaner notch',                       priority: 1 },
  midlegs:   { name: 'Mid Legs',             caption: 'coxa → pretarsal claws',                      priority: 1 },
  hindlegs:  { name: 'Hind Legs',            caption: 'six pin joints each',                         priority: 0, n: 8 },
  corbicula: { name: 'Corbicula',            caption: 'pollen basket',                               priority: 1 },
  petiole:   { name: 'Petiole',              caption: 'waist gimbal',                                priority: 1 },
  tergites:  { name: 'Tergite Rings',        caption: `${SPEC.tergites} telescoping plates`,         priority: 0, n: 6 },
  core:      { name: 'Amber Core',           caption: 'honey reactor',                               priority: 0, n: 9 },
  sting:     { name: 'Sting Assembly',       caption: 'sheath · 2 barbed lancets',                   priority: 0, n: 7 },
};

export const PART_IDS = Object.keys(PARTS);
