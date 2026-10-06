# Forms review checklist

These forms were rebuilt from the Lead Alchemist / GHL widgets, the old website forms and the carrier PDFs listed in
"Master List of Applications.xlsx". Each one is at `/forms/<slug>`. The items below are things the source didn't show
clearly. Please check them against the original and send corrections.

The app does not support **file uploads** yet. Wherever a source form asked for an upload (waivers, certificates,
obstacle descriptions), the web form either tells the applicant to email the file or asks for a text description instead.

| Form | Slug | Source |
| --- | --- | --- |
| Sports & Recreation Facility | `sports-facility-application` | LA 2rfgPVPlD4jV4cvjczTY + carrier PDF SFIC-STL-APP-001 (filled automatically) |
| Sport Event (MA tournaments, teams/leagues, sports events) | `sport-event-application` | LA pkfFEJ14mVIBrytwX7g5 |
| Camp / Clinic | `camp-clinic-application` | LA okKpbcPIEgUykRJQy2QE |
| Gymnastics Facility | `gymnastics-application` | DSI-Application.pdf + LA XMURWOwptJyzSHt4WA3d |
| Martial Arts Instructor | `martial-arts-instructor-application` | LA cxjHXnrzqLgvYRk6Vme9 (checked against the MASS MERCH MA INST PDF) |
| Martial Arts Single Event | `martial-arts-event-application` | LA survey Bt8KGBOGa5n7THVJuqsY |
| Aerial Instructor | `aerial-instructor-application` | LA FxLHdygRPQTmDs3jxH0y, with the reviewed changes |
| Aerial Yoga Studio | `aerial-yoga-studio-application` | dancestudioinsurance.com/aerial-yoga-studio-form (archived copy) |
| Fitness & Cross-Training Facility (yoga, pilates, health clubs) | `fitness-facility-application` | Fitness-and-Cross-Training-Facilities-DSI_App-Only.pdf |
| Special Event | `special-event-application` | LA ZyanGA4wMPk3RcUjFsW5 |
| Group Vendor Liability (promoters & producers) | `group-vendor-liability-application` | LA 4DPE8U76f8NuMA1dZV9M |
| LARP Event | `larp-event-application` | LARP-2026-AIS.pdf |
| Leisure & Sport Equipment | `leisure-sport-equipment-application` | LA BQxQ2q2nDqbqUQrKOX9U |
| Equipment Floater (cameras, gear, instruments) | `equipment-floater-application` | LA QtRy9zJIG8EanS6C4xyo |

**Not built yet: Aerial Dance Studio** (dancestudioinsurance.com/aerial-dance-studio-form). The page doesn't load its
questions for our tools, and no archived copy exists. Send the Lead Alchemist link and it can be added.

## Dropdowns whose options weren't visible (currently free text)
- **Sport Event:** Event Type, Event Level, "How did you hear about us?"
- **Martial Arts Single Event:** Event Type, Event Level, "How did you hear about us?"
- **Camp / Clinic:** Duration, Country, "How did you hear about us?"
- **Aerial Instructor:** General Aggregate Limit, "How did you hear about us?"
- **Special Event:** "How did you hear about us?"
- **Aerial Yoga Studio:** General Aggregate Limit. It uses $1M–$5M from the fitness PDF; please confirm.

## Per form
- **Sport Event**
  - The obstacle upload became an optional description box.
  - The waiver and risk-management PDF links are shown as text, not clickable links.
- **Camp / Clinic**
  - "How many sessions" is 1–5, because the source has 5 session blocks.
  - Session fields are required once a session is shown.
- **Gymnastics**
  - The website widget is the same GHL form as the Sports Facility one. The web form follows the PDF and adds the website-only questions.
  - Medical Payments and Occurrence options follow the PDF. Deductible has no $0 option.
  - Locations: the PDF's physical address plus up to 4 additional locations.
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
Only the Sports Facility form fills a carrier PDF automatically, the SFIC-STL-APP-001 template. Every other form gets
the application in Anthony Insurance's format, which is what goes to the carrier. To have a form fill the carrier's own
PDF (Fitness, Gymnastics/DSI, LARP, MA Instructor), send the fillable PDF file and it can be mapped the same way.
