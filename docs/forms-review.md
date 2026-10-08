# Forms review checklist

These forms were rebuilt from the Lead Alchemist widgets, the old website forms and the carrier PDFs listed in
"Master List of Applications.xlsx". Each one is at `/forms/<slug>`. The items below are things the source didn't show
clearly. Please check them against the original and send corrections.

The app does not support **file uploads** yet. Wherever a source form asked for an upload (waivers, certificates,
obstacle descriptions), the web form either tells the applicant to email the file or asks for a text description instead.

| Form | Slug | Source |
| --- | --- | --- |
| Sports & Recreation Facility | `sports-facility-application` | LA 2rfgPVPlD4jV4cvjczTY + carrier PDF SFIC-STL-APP-001 (filled automatically) |
| Sport Event (MA tournaments, teams/leagues, sports events) | `sport-event-application` | LA pkfFEJ14mVIBrytwX7g5 |
| Camp / Clinic | `camp-clinic-application` | LA okKpbcPIEgUykRJQy2QE |
| Gymnastics Facility | `gymnastics-application` | Same carrier form as Sports Facility (DSI "PH app" PDF = SFIC-STL-APP-001 04/2026, LA XMURWOwptJyzSHt4WA3d); fills the carrier PDF |
| Boxing Gym | `boxing-gym-application` | Same carrier form as Sports Facility (LA 2rfgPVPlD4jV4cvjczTY?insurance_type=Boxing); fills the carrier PDF |
| Martial Arts Instructor | `martial-arts-instructor-application` | LA cxjHXnrzqLgvYRk6Vme9 (checked against the MASS MERCH MA INST PDF) |
| Martial Arts Single Event | `martial-arts-event-application` | LA survey Bt8KGBOGa5n7THVJuqsY |
| Aerial Instructor | `aerial-instructor-application` | LA FxLHdygRPQTmDs3jxH0y, with the reviewed changes |
| Aerial Yoga Studio | `aerial-yoga-studio-application` | LA YK2al1vcLOnPCt3qW1kZ (embedded on /aerial-yoga-studio-form) |
| Aerial Dance Studio | `aerial-dance-studio-application` | LA YK2al1vcLOnPCt3qW1kZ (embedded on /aerial-dance-studio-form); same questions as Aerial Yoga Studio |
| Fitness & Cross-Training Facility (yoga, pilates, health clubs) | `fitness-facility-application` | Fitness-and-Cross-Training-Facilities-DSI_App-Only.pdf |
| Special Event | `special-event-application` | LA ZyanGA4wMPk3RcUjFsW5 |
| Group Vendor Liability (promoters & producers) | `group-vendor-liability-application` | LA 4DPE8U76f8NuMA1dZV9M |
| LARP Event | `larp-event-application` | LARP-2026-AIS.pdf |
| Leisure & Sport Equipment | `leisure-sport-equipment-application` | LA BQxQ2q2nDqbqUQrKOX9U |
| Equipment Floater (cameras, gear, instruments) | `equipment-floater-application` | LA QtRy9zJIG8EanS6C4xyo |

Not built: the **MMA / Boxing / Kickboxing / Wrestling Events** PDF (MMA-Boxing-Events-AIS-4623.pdf, in the media library
but not linked; the MMA pages use insoffer.com instead). Say if it should become a web form.

## Dropdowns whose options weren't visible (currently free text)
- **Sport Event:** Event Type, Event Level, "How did you hear about us?"
- **Martial Arts Single Event:** Event Type, Event Level, "How did you hear about us?"
- **Camp / Clinic:** Duration, Country, "How did you hear about us?"
- **Aerial Instructor:** General Aggregate Limit, "How did you hear about us?"
- **Special Event:** "How did you hear about us?"
- **Aerial Yoga / Aerial Dance Studio:** General Aggregate Limit and "How did you hear about us?". The aggregate uses $1M–$5M from the fitness PDF; please confirm.

## Per form
- **Sport Event**
  - The obstacle upload became an optional description box.
  - The waiver and risk-management PDF links are shown as text, not clickable links.
- **Camp / Clinic**
  - "How many sessions" is 1–5, because the source has 5 session blocks.
  - Session fields are required once a session is shown.
- **Gymnastics / Boxing Gym**
  - Both use the Sports Facility questions, because the website's gymnastics PDF and the boxing gym widget are the same carrier application (SFIC-STL-APP-001). Applications submitted on the old gymnastics form (built from DSI-Application.pdf) keep their answers, but only questions that still exist show on screen and in new PDFs.
- **Aerial Yoga / Aerial Dance Studio**
  - Rebuilt from the live widget: added Name of Policy Holder, Country and "Do you have a waiver and release system?"; dropped the aerial activities description, which the live form no longer asks.
  - The waiver upload became an "email it to Melanie@" note.
- **Martial Arts Instructor**
  - The limits chart was an image, so it was rebuilt from the PDF's prices. Please check it.
  - The PDF has questions the LA form doesn't ask: new/renewal, the single-event option, certificate details, the agent section and payment.
- **Martial Arts Single Event**
  - Couldn't see whether "Spectator / Premise Only" hides the participant questions. All are shown.
- **Aerial Instructor**
  - Up to 3 Additional Insureds were added.
  - The broken Terms & Conditions link is gone, and the waiver text is shown instead. Send the new waiver template to replace it.
  - The certification and waiver uploads became "email to melanie@" instructions.
- **Fitness Facility**
  - Question order was rebuilt from the fillable PDF's text.
  - Card details are deliberately not collected online.
  - The agent block shows Anthony Insurance Services' details.
- **Special Event**
  - Follow-ups (live music, liquor, multiple locations, prior years) are assumed to show only after "Yes".
  - Event times are text boxes.
- **Group Vendor Liability**
  - The source had no phone number or signature, so both were added.
  - "Number of insureds" is 0–5.
- **LARP Event**
  - The Medical Payment add-on percentage wasn't readable, so the option says "an additional percentage of Liability Premium".
- **Leisure & Sport Equipment**
  - The trailer and $150K follow-ups weren't visible.
  - The scheduled-items table is borrowed from the floater form.
- **Equipment Floater**
  - The rental-contract question is shown to everyone on the annual path.

## Carrier PDFs
Sports Facility, Gymnastics and Boxing Gym fill the carrier's SFIC-STL-APP-001 (04/2026) PDF automatically. Every other form gets
the application in Anthony Insurance's format, which is what goes to the carrier. To have a form fill the carrier's own
PDF (Fitness & Cross-Training, LARP 2026, MA Instructor, MMA Events), send the fillable PDF file and it can be mapped the same way.
