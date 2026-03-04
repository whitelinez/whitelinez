
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** whitelinez-frontend
- **Date:** 2026-03-04
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC001 FPS badge overlay is visible on the stream
- **Test Code:** [TC001_FPS_badge_overlay_is_visible_on_the_stream.py](./TC001_FPS_badge_overlay_is_visible_on_the_stream.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/2b0a340b-7bf4-4d23-b998-12911f1a3b29
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC002 Detection zone overlay is drawn on the stream
- **Test Code:** [TC002_Detection_zone_overlay_is_drawn_on_the_stream.py](./TC002_Detection_zone_overlay_is_drawn_on_the_stream.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Detection zone overlay not visible on the stream after dashboard load
- No DOM element with an id or label corresponding to a detection zone overlay was found on the page
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/c154b8f6-b3c8-46e1-9b3f-2c3f400b3f99
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC004 Floating vehicle count widget is visible on the main dashboard
- **Test Code:** [TC004_Floating_vehicle_count_widget_is_visible_on_the_main_dashboard.py](./TC004_Floating_vehicle_count_widget_is_visible_on_the_main_dashboard.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/5a0aecc9-9232-4877-8a7d-0336ee32b594
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC005 Vehicle count value updates over time (realtime WebSocket feed)
- **Test Code:** [TC005_Vehicle_count_value_updates_over_time_realtime_WebSocket_feed.py](./TC005_Vehicle_count_value_updates_over_time_realtime_WebSocket_feed.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Vehicle count did not change across three measurements (values: '0', '0', 'TOTAL0'), therefore realtime updates were not observed.
- No updates were received during the ~20 second observation window between the first and last measurement.
- The final extraction returned 'TOTAL0' (non-numeric prefix), indicating inconsistent or unexpected formatting of the displayed value.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/c0096905-aff6-4d18-8c35-97c7cd05c356
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC008 Guess mode progress display appears when entering guess mode
- **Test Code:** [TC008_Guess_mode_progress_display_appears_when_entering_guess_mode.py](./TC008_Guess_mode_progress_display_appears_when_entering_guess_mode.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Guess mode progress-style display (X/Y vehicles) not found on page.
- No 'Guess' or 'Start Guess' control present to enter guess mode.
- Without a control to enter guess mode, verification of the progress-style widget cannot be completed.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/6f5d1f4c-9ca2-4b84-8904-d612d29ec179
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC011 Place a valid guess during an active round and see an active receipt
- **Test Code:** [TC011_Place_a_valid_guess_during_an_active_round_and_see_an_active_receipt.py](./TC011_Place_a_valid_guess_during_an_active_round_and_see_an_active_receipt.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Login form not found after clicking the Login button and after navigating to /login (no email/password inputs present).
- Email and password input fields are not present on the page, preventing authentication with test credentials.
- Vehicle count guess input field not found, so it is not possible to submit a numeric vehicle-count guess.
- "Active" guess receipt text was not visible after the interactions, so the post-submission receipt cannot be verified.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/a977becc-9aa5-42fe-ae2f-5887c3e89656
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC012 Scorecard appears after round resolves for a submitted guess
- **Test Code:** [TC012_Scorecard_appears_after_round_resolves_for_a_submitted_guess.py](./TC012_Scorecard_appears_after_round_resolves_for_a_submitted_guess.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Login form (email and password input fields) not found on /login page after navigation.
- Vehicle guess input field or Submit Guess button not present or not detectable; cannot place a guess.
- Scoring card (EXACT/CLOSE/MISS) cannot be verified because the guess submission step could not be performed.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/d70c3156-8b22-4370-bca1-50d9c27c3fd9
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC013 Non-numeric guess input shows validation error and blocks submission
- **Test Code:** [TC013_Non_numeric_guess_input_shows_validation_error_and_blocks_submission.py](./TC013_Non_numeric_guess_input_shows_validation_error_and_blocks_submission.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Login form input fields (email and password) not present on the /login page or after clicking the Login button.
- Login modal did not open after clicking the Login button (interaction performed twice) and no interactive login controls are available.
- Authentication cannot be completed, therefore the vehicle-guess input and validation cannot be tested.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/99b4ac6e-7207-45bb-a2f4-783acb445a21
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC019 Open Leaderboard and view default ranked list
- **Test Code:** [TC019_Open_Leaderboard_and_view_default_ranked_list.py](./TC019_Open_Leaderboard_and_view_default_ranked_list.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Leaderboard panel did not display any ranked user list after opening; message 'Open tab to load rankings.' is present on the panel.
- No usernames with associated numeric point totals (a populated ranking) were found on the leaderboard panel; only a profile label 'AccountAdmin' and '0PTS' near the account header were present.
- Expected 'Points' column or multiple user point totals are not present on the page, so the leaderboard content is missing or not loaded.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/ad932acc-904a-4ceb-b83a-c1b36bfc5e0f
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC020 Switch to 3MIN leaderboard tab and see updated list
- **Test Code:** [TC020_Switch_to_3MIN_leaderboard_tab_and_see_updated_list.py](./TC020_Switch_to_3MIN_leaderboard_tab_and_see_updated_list.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Leaderboard (RANKINGS) tab not found in page interactive elements; cannot click to open the leaderboard.
- 3MIN time-window tab not present or not clickable on the page; cannot switch time window to verify leaderboard update.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/be5d8c71-0c0c-4d83-b851-fca6a7ef138f
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC022 Manual refresh reloads scores on 3MIN tab
- **Test Code:** [TC022_Manual_refresh_reloads_scores_on_3MIN_tab.py](./TC022_Manual_refresh_reloads_scores_on_3MIN_tab.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- 3MIN time-window control not found on the Leaderboard panel after multiple search and scroll attempts.
- Refresh button for the leaderboard not found on the page.
- Ranked list element is not visible on the Leaderboard panel.
- Leaderboard content appears to be rendered inside a shadow root or not mounted, preventing interaction.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/6bd581fe-0c20-4703-9d6c-258965d8eb75
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC025 Send a chat message with Enter and see it appear in chat panel
- **Test Code:** [TC025_Send_a_chat_message_with_Enter_and_see_it_appear_in_chat_panel.py](./TC025_Send_a_chat_message_with_Enter_and_see_it_appear_in_chat_panel.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Chat input field not found on page
- No interactive element labeled 'Chat' or chat input present after opening the Chat tab
- Unable to type message because chat input is missing
- Message 'Hello chat - Enter send' not visible because it could not be sent
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/78c52617-dd9f-4d84-8575-31cfeda959e8
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC026 Send a chat message with the Send button and see it appear
- **Test Code:** [TC026_Send_a_chat_message_with_the_Send_button_and_see_it_appear.py](./TC026_Send_a_chat_message_with_the_Send_button_and_see_it_appear.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Chat input field not found on page after activating the Chat tab and performing scrolls
- Send button not found on page after activating the Chat tab and performing scrolls
- Chat panel controls required to post a message are missing from the interactive elements list
- Unable to verify posting functionality because message input and Send control are not present

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/73a49f5a-c036-4853-a35a-81bb05a92ca6
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC027 Posting a message creates an activity feed overlay entry
- **Test Code:** [TC027_Posting_a_message_creates_an_activity_feed_overlay_entry.py](./TC027_Posting_a_message_creates_an_activity_feed_overlay_entry.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Chat input field not found on page; no input element for sending chat messages detected.
- Activity feed/overlay not present over the stream area and no interactive element labeled 'Activity' or similar found.
- Unable to send message because no chat input or send control exists to enter and submit 'Overlay check message'.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/7e050ea0-560b-436d-9a9b-e237f4fef453
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC031 Register a new account from the auth modal and see avatar + balance in the nav
- **Test Code:** [TC031_Register_a_new_account_from_the_auth_modal_and_see_avatar__balance_in_the_nav.py](./TC031_Register_a_new_account_from_the_auth_modal_and_see_avatar__balance_in_the_nav.py)
- **Test Error:** TEST FAILURE

ASSERTIONS:
- Auth modal did not appear after clicking the Login button.
- Register tab not found on the page or in any visible modal after interactions.
- No email or password input fields are present to perform registration.
- No navigation element or link exists on the current page to reach a registration flow.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/b44a350c-9eae-4a7e-be46-0fa706b27bcc/b2c6ac07-6780-4b7d-859d-6ba7f768ac83
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **13.33** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---