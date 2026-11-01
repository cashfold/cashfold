# Feature Specification: Math in Amount Fields

**Feature Branch**: `020-math-in-amounts`

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: "I want to have an ability to use math in amounts during creating transactions and in other amount inputs"

## Clarifications

### Session 2026-11-02

- Q: When the person leaves an amount field, should the typed calculation be replaced by its result, or stay in the field with the result shown beside it? → A: It stays in the field with the result shown beside it, in the form and after leaving the field. The result is what is saved.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Type a sum instead of working it out (Priority: P1)

A person adds a transaction after a shop visit with a receipt of several items. Instead of adding the items on a calculator and typing the total, they type `12.50 + 3.20 * 2 + 4` into the Amount field. As they type, the app shows the result, `22.90`, beside or under the field. The calculation stays in the field and the result stays beside it, and the amount that is saved is `22.90`. The same works for splitting a bill (`84 / 3`), taking a discount (`120 - 15`) and adding up several payments (`40 + 25.5 + 10`).

**Why this priority**: It is the whole request, and the add-transaction Amount field is where people enter money most often.

**Independent Test**: Open the add-transaction sheet, type `12.50 + 3.20 * 2 + 4` in Amount, see `22.90` shown, save, and see a transaction of exactly 22.90 in the list. Repeat with `84 / 3`, `120 - 15` and `(10 + 5) * 2`.

**Acceptance Scenarios**:

1. **Given** the Amount field of a new transaction, **When** the person types `12.50 + 3.20 * 2 + 4`, **Then** the result `22.90` is shown before they save, and saving records exactly 22.90.
2. **Given** an expression with brackets, **When** the person types `(10 + 5) * 2`, **Then** the result is `30.00`; and `10 + 5 * 2` is `20.00` (multiplication and division first).
3. **Given** a plain number, **When** the person types `12.50`, **Then** nothing changes from today: no result line, the same rules and messages as before.
4. **Given** a language that writes `1 234,56` or `1.234,56`, **When** the person types `1 234,50 + 10,25`, **Then** the numbers are read with that language's marks and the result is `1 244,75`.
5. **Given** the expression is incomplete or invalid (`12 +`, `5 / 0`, `abc`), **When** the person tries to save, **Then** the field shows a short message in the person's language saying what is wrong, nothing is saved, and the typed text is kept.
6. **Given** a valid expression, **When** the person leaves the field, **Then** the calculation is still in the field and the result (`22.90`) is still shown beside it, so what is saved is what is on screen.
7. **Given** a calculation with a mistake in one number, **When** the person goes back to the field and corrects that number, **Then** the rest of the calculation is still there and the result updates.

---

### User Story 2 - The same in every other amount field (Priority: P2)

The same calculation works in every field where a person types a money amount: the second amount of a transfer between currencies, the opening balance of an account, the limit and allocation of a budget, the target of a goal, the amount of a schedule, and the minimum and maximum of the transaction filter. The result is shown the same way and follows the same rules.

**Why this priority**: People expect the field to behave the same everywhere, but the add-transaction field is the one they use most.

**Independent Test**: In each of those fields type `100 / 4 + 5` and see `30.00` (in a currency with two decimals) before saving; save and check the stored value.

**Acceptance Scenarios**:

1. **Given** any money field listed above, **When** the person types a calculation, **Then** it behaves as in the add-transaction field: the result is shown, an invalid expression is explained, a plain number behaves as before.
2. **Given** a currency with no decimals or with three decimals, **When** the person types a calculation, **Then** the result is shown and saved with that currency's own decimals.
3. **Given** a field that is not an amount of money (an exchange rate, a latitude or longitude, a text note), **When** the person types `2 + 2`, **Then** it is treated as before: calculation is not offered there.

---

### User Story 3 - Exact results, with no surprise rounding (Priority: P2)

A person never ends up with an amount that is a cent off because of how the sum was computed. Results are exact: `10 / 3 * 3` is `10.00`, and `0.1 + 0.2` is `0.30`. When a result has more decimals than the currency can hold, for example `10 / 3` in a two-decimal currency, it is rounded once, at the end, by the app's one rounding rule, and the rounded result is shown before anything is saved.

**Why this priority**: It is a finance app, and exactness is a core promise. It does not stand alone, because it only matters once calculation exists.

**Independent Test**: Type `0.1 + 0.2`, `10 / 3 * 3` and `10 / 3` in turn: the results are `0.30`, `10.00` and `3.33`, each shown before saving.

**Acceptance Scenarios**:

1. **Given** a calculation whose steps are not exact on their own (`10 / 3 * 3`), **When** the result is shown, **Then** it is `10.00`.
2. **Given** a result that has more decimals than the currency allows, **When** it is shown, **Then** it is rounded once, half to even, to the currency's decimals, and the person sees the rounded value before saving.
3. **Given** a result too large or too small to be a valid amount, **When** the person tries to save, **Then** the same message appears as when typing such a number today.
4. **Given** a plain typed number with too many decimals (`1.239` in a two-decimal currency), **When** the person tries to save, **Then** it is still an error, as today: only the result of a calculation is rounded, not a number typed as it is.

---

### Edge Cases

- Spaces anywhere in the expression, and the keyboard's `x` or `×` for multiplication and `÷` or `/` for division: all accepted. A leading minus (`-5 + 8`) is accepted; whether a negative result may be saved follows the same rule as typing that number today.
- Two operators in a row (`5 ++ 3`), an unclosed bracket and an empty bracket pair are errors with a message, not guesses.
- A very long expression, or many nested brackets, is handled or refused with a message; it never freezes the form.
- The expression is not saved: only the result is. Opening a saved transaction for editing shows the amount, not the expression, because the calculation is not kept after the form is closed.
- Copy and paste: pasting `12,5+3` from another app works as typing it does.
- Privacy mode: forms show real figures, as today; the calculation line is part of the form.
- On a phone whose number keypad has no operator keys, the person can still switch keyboards to type operators; the app does not remove this possibility by forcing a keypad that hides them.
- Right-to-left layouts: the typed expression and the result are laid out correctly and the numbers keep their reading order.
- Screen readers: the result is announced politely when it changes and is read with the field, and an error is announced as errors are today.
- Filters (minimum and maximum) with a calculation behave like any other amount; an empty field means no limit, as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every field where a person types an amount of money MUST accept a calculation made of numbers, `+`, `−` (`-`), `×` (`*`, `x`), `÷` (`/`) and brackets, with the usual order of operations (brackets, then multiplication and division, then addition and subtraction, left to right).
- **FR-002**: The fields are: the amount in the add-transaction sheet, both amounts of a transfer, the opening balance, credit limit and balance target of an account, the budget limit and allocation, the goal target, the amounts of a schedule, and the minimum and maximum of the transaction filter. Fields that are not money (exchange rates, coordinates, text) MUST NOT accept calculations.
- **FR-003**: While the person types a valid calculation, the app MUST show its result beside or under the field, in the person's language and in the field's currency, without saving anything. A plain number MUST show no result line and MUST behave exactly as it does today.
- **FR-004**: A valid calculation MUST stay in the field as typed, also after the person leaves it, with its result shown beside the field; the result is what is saved.
- **FR-005**: Numbers in a calculation MUST be read with the language's own thousands and decimal marks, with the same leniency about spaces and the decimal mark that a single typed amount has today.
- **FR-006**: Calculations MUST be exact: no step may lose or invent a fraction of a cent, so `0.1 + 0.2` is `0.30` and `10 / 3 * 3` is `10.00`.
- **FR-007**: A result with more decimals than the currency allows MUST be rounded once, at the end, by the app's single rounding rule (half to even), and the rounded value MUST be shown before saving. A plain number typed with too many decimals MUST remain an error.
- **FR-008**: An invalid calculation (incomplete, unknown characters, unbalanced brackets, division by zero) or a result outside the allowed range MUST NOT be saved, MUST show a short message in the person's language that says what is wrong, and MUST keep the typed text.
- **FR-009**: The saved value MUST be the result only; no expression is stored, synced or exported, and nothing changes in the stored data, the sync format, backups or exports.
- **FR-010**: The result line and the error message MUST be reachable by screen readers (announced politely when the result changes), usable with the keyboard alone, readable in light and dark themes and in right-to-left layouts, and MUST NOT shift the layout of the form when it appears.
- **FR-011**: All text for the feature MUST exist in every language the app offers.
- **FR-012**: A calculation MUST be evaluated on the person's device; nothing is sent anywhere.

### Key Entities

- **Amount expression**: the text a person types in an amount field, made of numbers, operators and brackets. It is temporary: it exists only in the field.
- **Amount result**: the exact value of an expression, rounded once to the currency's decimals. It is the only thing that is saved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can enter a total made of at least five numbers and two operators in the add-transaction sheet without leaving the app, and sees the result before saving in 100% of tries.
- **SC-002**: In a check of 1,000 random calculations in currencies with 0, 2 and 3 decimals, 100% of results equal the mathematically exact result rounded once half to even.
- **SC-003**: 100% of the money fields listed in FR-002 accept a calculation, and 0 of the non-money fields do.
- **SC-004**: A plain number behaves exactly as before in 100% of the existing amount tests: same value, same messages.
- **SC-005**: Every invalid calculation tried (a set covering incomplete, unknown characters, unbalanced brackets, division by zero and out-of-range results) is refused with a message in the person's language, and no amount is saved from it.
- **SC-006**: The result line and error messages pass the automated accessibility checks in light and dark themes and in a right-to-left layout.

## Assumptions

- Percent (`10%`), powers, functions (`sqrt`) and variables or memory are out of scope; a later feature can add them.
- The operators are `+`, `−`, `×`, `÷` and brackets, as above; a typed `x` is multiplication only between numbers (`2 x 3`).
- "Rounded once at the end" follows the project's existing rule for money (half to even); a plain number typed with too many decimals stays an error because that is a typing mistake, while a calculated result is a computed value.
- The result is shown as a line beside or under the field; the calculation stays in the field as typed, so the person can correct one number without retyping the sum.
- Whether a negative result may be saved follows the existing rule of each field (for example, a transaction amount is entered as a positive number and the direction decides the sign).
- Stored amounts stay whole minor units; nothing about money storage, sync, backup or export changes.
- On phones, the person may need to switch to a keyboard with the operator keys; the app does not hide the operators by forcing a number-only keypad.
