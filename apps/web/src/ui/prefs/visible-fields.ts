import { fieldsOf, hasValue, type FieldDef, type FieldValues, type FormId } from './fields';
import type { Prefs } from './schema';

export type FieldGroup = 'main' | 'more' | 'advanced';
export interface FieldPlacement {
  def: FieldDef;
  group: FieldGroup;
}
export interface VisibleFields {
  /** In registry order: where each applicable field goes. */
  fields: FieldPlacement[];
  /** Whether a "More details" group exists for this form state. */
  hasMore: boolean;
  /** Whether that group renders open. */
  moreOpen: boolean;
}

/**
 * Which fields a form shows (data-model §2).
 *  1. Essential fields are always in the main view.
 *  2. An optional field is in the main view when the person made it default (or it is default-visible and they have not chosen);
 *     otherwise it sits in "More details". A hidden optional field that already holds a value (an entry being edited) is not hidden from view:
 *     it stays in "More details" and the group opens.
 *  3. Technical fields only ever sit in the Advanced group.
 */
export function visibleFields(form: FormId, prefs: Pick<Prefs, 'optionalFields' | 'moreDetailsOpen'>, values: FieldValues, mode: 'new' | 'edit'): VisibleFields {
  const fields: FieldPlacement[] = [];
  let filledHidden = false;
  for (const def of fieldsOf(form)) {
    if (def.appliesTo && !def.appliesTo(values)) continue;
    if (def.cls === 'E') fields.push({ def, group: 'main' });
    else if (def.cls === 'T') fields.push({ def, group: 'advanced' });
    else {
      const shown = prefs.optionalFields[def.id] ?? def.defaultVisible;
      if (shown) fields.push({ def, group: 'main' });
      else {
        fields.push({ def, group: 'more' });
        if (hasValue(def, values)) filledHidden = true;
      }
    }
  }
  const hasMore = fields.some((f) => f.group === 'more');
  return { fields, hasMore, moreOpen: hasMore && (prefs.moreDetailsOpen || (mode === 'edit' && filledHidden)) };
}
