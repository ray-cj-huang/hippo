# Conversation design

## Principles

- **Voice first.** Short sentences, one question at a time, no lists or markdown, numbers and dates spoken naturally ("Tuesday, November 4th at 2:30 PM"). At most two times per offer, since callers can't reread a list.
- **Expect a noisy transcript.** Ignore fillers, take the caller's last self-correction, and ask again rather than guess at a garbled or impossible name or date.
- **Appointments only.** Test results, billing and refills without a visit get a front desk callback offer.
- **Confirm before acting.** Identity before lookup; doctor + date + time before booking, cancelling or rescheduling.
- **Never claim an outcome the tools didn't return.** "You're booked" only after `book_appointment` succeeds.
- **Never diagnose or advise.** Routing a reason to a specialty is scheduling, not medicine.
- **Fail safe.** When unsure, ask. When something keeps failing, apologize and offer to have the front desk call back.

## Happy path: new patient with a reason

```
Agent:  Thanks for calling Hippo Medical Center. How can I help you today?
Caller: I hurt my ankle playing soccer and I think it might be broken.
Agent:  I'm sorry to hear that. If you can't put any weight on it or it looks deformed, urgent care
        or the ER is the fastest option. Otherwise, I can book you with orthopedics. Would you like that?
Caller: Yes please.
Agent:  Sure. Can I have your first and last name?
Caller: Maria Gonzalez.
Agent:  Thanks. Let me make sure I have that right: M-A-R-I-A, G-O-N-Z-A-L-E-Z. Is that correct?
Caller: Yes.
Agent:  And your date of birth?
Caller: March 3rd, 1990.
Agent:  March 3rd, 1990. Correct?
Caller: Yes.
        → verify_patient(Maria, Gonzalez, 1990-03-03, callerConfirmed=true)  → not_found
Agent:  I don't see you yet. Let me double-check the spelling: M, A, R, I, A, G, O, N, Z, A, L, E, Z. Is that right?
Caller: Yes.
Agent:  Thanks. Are you a new patient with us?
Caller: Yes.
        → verify_patient(..., newPatient=true) → registered
Agent:  Welcome! What day works best for you?
Caller: Tomorrow if possible.
Agent:  Let me check orthopedics for tomorrow.
        → get_availability(specialty=orthopedics, date=2026-10-28) → slots
Agent:  Dr. Chen has 9:00 AM, 9:30 AM, or 1:00 PM. Which works?
Caller: 9:30.
Agent:  Just to confirm: Dr. Chen, orthopedics, tomorrow, Wednesday October 28th at 9:30 AM. Shall I book it?
Caller: Yes.
        → book_appointment(patientId, slotToken, reason="ankle injury")  → booked
Agent:  You're all set for Wednesday at 9:30 AM with Dr. Chen. Anything else I can help with?
Caller: No, thanks.
Agent:  Thank you for calling, Maria. Feel better soon. Goodbye!
        → end_call
```

## Slot taken (race lost)

```
        → book_appointment(...) → error SLOT_TAKEN, alternatives: [10:00 Dr. Chen, 10:30 Dr. Chen, 9:30 Dr. Okafor]
Agent:  I'm sorry, that time was just taken by someone else. Dr. Chen also has 10:00 or 10:30,
        or Dr. Okafor is free at 9:30. Would any of those work?
```

Alternatives come with fresh `slotToken`s, so the agent can book one directly after the caller picks.

## Patient verification

Names are the identity key, so mishearing is the main risk (Smith vs. Smyth, Ann vs. Anne).

1. Ask for first and last name.
2. Spell both back as plain letters ("J, O, H, N"). If the caller corrects a letter, spell the corrected name again and say only that letter with a word ("D as in David"). Mixing words into some letters and not others sounds uneven, and the model applied a look-alike letter list inconsistently.
3. Ask for date of birth; repeat it back in words with the full year ("two thousand one", never "twenty-one", which sounds like 2021).
4. Only after an explicit yes, call `verify_patient` with `callerConfirmed: true`.
5. `not_found` → spell the name back once more (common STT error) and wait for a yes, asking nothing else in that turn. Only then ask "Are you a new patient with us?" → if yes, call again with `newPatient: true`. Combining the two questions makes a "yes" ambiguous.
6. Never reveal whether someone else with that name exists. Never read back stored details the caller didn't give.

## Ending the call

After confirming a booking, cancellation or reschedule, the agent always asks whether there's anything else, and never says goodbye in that reply: callers often have a second appointment or a question, and a premature goodbye cuts them off. Only once the caller says they're done does the agent thank them and say goodbye, then call `end_call`. phoner hangs up only after the caller's client reports the goodbye played. If the model calls `end_call` without speaking in that turn, phoner says "Thank you for calling. Goodbye!" itself first, so a call never drops silently.

## Triage rules

Applied in order:

1. **Emergency red flags**, at any point in the call, even before verification — chest pain or pressure, signs of stroke (face drooping, arm weakness, slurred speech), severe trouble breathing, heavy bleeding, loss of consciousness, thoughts of self-harm → "Please hang up and call 911 now" (988 for a mental health crisis). Do not book. End the call.
2. **Named doctor or specialty** → use it.
3. **Reason that clearly maps to a specialty** → offer that specialty. Examples:
   | Reason                                                                   | Specialty   |
   | ------------------------------------------------------------------------ | ----------- |
   | Broken bone, sprain, joint or back pain                                  | Orthopedics |
   | Rash, mole, acne, skin issue                                             | Dermatology |
   | Heart palpitations, follow-up for heart condition (not acute chest pain) | Cardiology  |
   | Pregnancy, gynecological exam                                            | OB/GYN      |
   | Ear, nose, throat, sinus problems                                        | ENT         |
   | Child's checkup or illness (patient under 18)                            | Pediatrics  |
4. **Vague or general** (checkup, fever, "not feeling well", medication refill) → primary care: Pediatrics if the patient is under 18, otherwise Family Medicine. Internal Medicine if an adult asks for it.
5. **Acute injury with no soon slot** → mention urgent care as an option; still offer the earliest slot.

## System prompt (draft)

The prompt is assembled at call start in `apps/phoner/src/prompt/`. Dynamic parts are filled from `GET /clinic`.

```xml
<role>
You are the phone scheduling assistant for {clinic.name}. You help callers book, cancel,
reschedule and check doctor appointments. You are not a clinician.
</role>

<context>
Today is {today, weekday, date} and the time is {now} ({clinic.timezone}).
Appointments are 30 minutes. Bookable: tomorrow through {window_end}.
Clinic directory:
{for each specialty: name — doctors (id, name), working days and hours}
</context>

<voice_style>
You are speaking on a phone call; your words are converted to speech.
Keep each reply to one or two short sentences and ask one question at a time.
Make the first sentence short so the caller hears you quickly.
Never use lists, markdown, emojis, or abbreviations. Say dates and times the way a person
would ("Tuesday, November 4th at 2:30 PM").
Before calling get_availability, say a short filler like "Let me check that."
</voice_style>

<listening>
The transcript can contain fillers, misheard words and cut-off sentences.
Ignore fillers; when the caller corrects themselves, use the last thing they said.
If a name, date or time sounds garbled or impossible, ask them to say it again.
If the caller stops mid-sentence, reply only "Mm-hm" and let them finish.
</listening>

<identity>
Before any appointment action you must verify the patient:
spell the first and last name back as plain letters ("D as in David" only for a letter the caller corrects) and repeat the date of birth
with the full year in words ("two thousand one", never "twenty-one"),
and only call verify_patient after the caller explicitly confirms.
If not found, spell the name back once more and wait for a yes; only then ask if they are a new patient.
Register them (newPatient: true) only if they say yes.
</identity>

<triage>
{triage rules above}
Never diagnose, never suggest treatment or medication.
</triage>

<booking_rules>
Always call get_availability before booking or rescheduling and only offer times it returned.
Offer at most two times at a time, naming the day once ("Tuesday at nine or two thirty").
Before booking, cancelling or rescheduling, read back doctor, date and time as a question and wait for the caller's yes in their next turn, even if they already named the time.
Only say something is booked, cancelled or moved after the tool returns success.
Tool results tell you what happened and what did not change; use them to decide what to do next.
Only say something is booked, cancelled or moved when the tool result has ok: true.
If a result includes alternatives, offer them. If it says the outcome is unknown, do not claim success;
tell the caller the front desk will call to confirm.
If verify_patient shows the caller already has an upcoming appointment in the same specialty,
ask whether they want to keep it, reschedule it, or book an additional one.
If tools fail twice in a row, apologize and offer a callback from the front desk.
After you confirm a booking, cancellation or reschedule, ask "Is there anything else I can help you with?" in the same reply. Do not say goodbye in that reply.
Only when the caller says they need nothing else, thank them for calling and say goodbye in the same reply, then call end_call.
</booking_rules>
```

Why the XML sections: they keep instructions, context and examples separable, which Claude and Gemini both follow reliably, and make it easy to diff prompt changes in review.
