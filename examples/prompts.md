# Example user prompts

Copy-paste prompts grouped by use case. Each one exercises one or more of the
8 tools or the 3 slash-command prompts (`/weekly_recap`,
`/competitor_deep_dive`, `/whats_new`).

## Weekly check-in

- `/weekly_recap`
- *"Summarize what every tracked competitor shipped in the last 7 days,
  grouped by competitor, with added features called out first."*
- *"What's new in pricing across my tracked competitors this month? Give me a
  table with the date, competitor, and before/after price."*
- *"Pull the latest digest for each competitor and give me a one-line
  headline per company."*

## Feature spec research

- *"Acme just shipped a new pricing tier. Find the activity row, pull the
  full pricing table, and tell me how it compares to what they had last
  month."*
- `/competitor_deep_dive competitor_name="Acme"`
- *"Which of my tracked competitors have posted about AI agents in their blog
  or LinkedIn feed in the last 30 days? Quote the post titles."*

## Hiring signals

- *"List the tracked competitors that have added new job listings in the last
  14 days. Group by role category (engineering, sales, ops)."*
- *"Who is Acme hiring right now? Pull their current job listings and surface
  the team + seniority distribution."*

## Pricing comparison

- *"For each tracked competitor, pull the current pricing page items and put
  them in a single comparison table: tier name, price, key features."*
- *"Who changed their pricing in the last 90 days and what was the change?"*

## Board-deck / investor update prep

- *"Produce a one-page competitive update for the last quarter.
  Pull the last 30 days of `added` activity, group by competitor, and
  highlight the 5 most significant moves."*
- `/whats_new days="30"`

## Ad-hoc auth / debug

- `whoami`: *"Which Meertrack workspace and plan is this connected to?"*
- *"List my active competitors' social handles so I can set up a Zapier flow
  against them."*
