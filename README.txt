COMMON ROOM - STUDENT HELPDESK
==============================

This ZIP contains a standalone version built with only:
- index.html
- style.css
- app.js

Open index.html in a browser to run it. No React, TypeScript, Node.js, or
database installation is required.

Included workflows:
- Student registration and sign-in
- Lecturer sign-in using pre-registered staff IDs
- Lecturer ID field validated against the registered lecturer directory
- Ticket creation and automatic lecturer routing by the exact Lecturer ID
- Student ticket history
- Lecturer oldest-first queue
- Responses and status updates
- Student close and reply-to-reopen actions
- Cross-tab live updates using BroadcastChannel/localStorage

Demo accounts:
- Student: CSC/2024/0142 / student123
- Lecturer: STAFF-1042 / lecturer123
- Other lecturer accounts use the same lecturer123 password.

When a student opens a ticket, they must enter the lecturer's registered
Lecturer ID (for example STAFF-1042). The lecturer can then sign in with that
same ID and see every ticket assigned to it. Lecturer IDs are currently the
pre-registered staff IDs in app.js.

Data is stored in the browser's localStorage. To reset the demo, clear site
data for the page and open index.html again.