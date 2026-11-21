/**
 * "Did you know": true facts shown while a card's hook is being written for
 * the learner's project.
 *
 * Every fact here was researched and checked against the source beside it
 * (docs/TEACHING.md: facts are sourced, never written by a model at run
 * time). The bar: a real event with a consequence and, where possible, a
 * number; directly about the idea or tool it is filed under; at most two or
 * three short sentences in plain words.
 *
 * To add one, find a source you have read, and add the fact with its link.
 * `test/lesson.test.ts` holds every entry to the rules.
 */

export interface Fact {
  text: string;
  /** Where it was checked. Not shown to the learner; kept so the fact can be checked again. */
  source: string;
}

/** By idea id or tool id. One is shown per card, and a card always shows the same one. */
export const FACTS: Readonly<Record<string, readonly Fact[]>> = {
  "anthropic-sdk": [
    // Claude Docs: Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    { text: "The Anthropic API can remember the start of a long prompt for 5 minutes. As of 2026, reading that saved part again costs a tenth or less of the normal input price.", source: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching" },
  ],
  "api-route": [
    // Wikipedia: 2022 Optus data breach: https://en.wikipedia.org/wiki/2022_Optus_data_breach
    { text: "In September 2022 data on up to 10 million Optus customers, about a third of Australia's population, was taken. The government said human error had left a weakness in one of the company's APIs.", source: "https://en.wikipedia.org/wiki/2022_Optus_data_breach" },
    // Krebs on Security: https://krebsonsecurity.com/2018/11/usps-site-exposed-data-on-60-million-users/
    { text: "Until November 2018 a US Postal Service API let any logged-in user look up account details of some 60 million other users. A researcher said he had reported it more than a year earlier.", source: "https://krebsonsecurity.com/2018/11/usps-site-exposed-data-on-60-million-users/" },
    // TechCrunch: https://techcrunch.com/2021/05/05/peloton-bug-account-data-leak/
    { text: "In 2021 a researcher found that Peloton's API handed out private account data, such as age, weight and city, without checking who was asking. Peloton had more than 3 million subscribers.", source: "https://techcrunch.com/2021/05/05/peloton-bug-account-data-leak/" },
    // TechCrunch: https://techcrunch.com/2023/01/19/t-mobile-data-breach/
    { text: "From 25 November 2022 an attacker pulled data on 37 million T-Mobile customers through a single API. T-Mobile did not notice until 5 January 2023.", source: "https://techcrunch.com/2023/01/19/t-mobile-data-breach/" },
  ],
  "async-await": [
    // Wikipedia: Therac-25: https://en.wikipedia.org/wiki/Therac-25
    { text: "Between 1985 and 1987 the Therac-25 radiation machine gave at least six patients massive overdoses. Race conditions in its software meant quick typing by the operator could trigger a deadly beam.", source: "https://en.wikipedia.org/wiki/Therac-25" },
    // Wikipedia: Northeast blackout of 2003: https://en.wikipedia.org/wiki/Northeast_blackout_of_2003
    { text: "In the 2003 Northeast blackout, a race condition froze a power company's alarm system for over an hour, so operators did not see the grid failing. About 55 million people lost power.", source: "https://en.wikipedia.org/wiki/Northeast_blackout_of_2003" },
    // AWS post-event summary: https://aws.amazon.com/message/101925/
    { text: "In October 2025 two automated AWS processes updated the same DNS record in the wrong order and left it empty. This race condition disrupted services in AWS's Northern Virginia region for over 14 hours.", source: "https://aws.amazon.com/message/101925/" },
    // GitHub Blog: https://github.blog/2021-03-18-how-we-found-and-fixed-a-rare-race-condition-in-our-session-handling/
    { text: "In March 2021 a rare race condition on GitHub handed a few users someone else's login session. To be safe, GitHub logged out every user on the site.", source: "https://github.blog/2021-03-18-how-we-found-and-fixed-a-rare-race-condition-in-our-session-handling/" },
  ],
  "auth-token": [
    // Meta Newsroom: https://about.fb.com/news/2018/10/update-on-security-issue/
    { text: "In 2018 attackers stole the access tokens of about 30 million Facebook accounts. A token keeps a person logged in, so holding one meant getting into the account without ever knowing the password.", source: "https://about.fb.com/news/2018/10/update-on-security-issue/" },
    // Okta Security root cause report: https://sec.okta.com/articles/2023/11/unauthorized-access-oktas-support-case-management-system-root-cause/
    { text: "In 2023 an intruder got into Okta's support system and opened files from 134 customers. Some files held session tokens, which were then used to hijack the live Okta sessions of 5 customers.", source: "https://sec.okta.com/articles/2023/11/unauthorized-access-oktas-support-case-management-system-root-cause/" },
    // CircleCI incident report: https://circleci.com/blog/jan-4-2023-incident-report/
    { text: "In December 2022 malware on a CircleCI engineer's laptop stole a login session that had already passed two-factor checks. The attacker used it to pose as the engineer and reach production systems.", source: "https://circleci.com/blog/jan-4-2023-incident-report/" },
    // Vice Motherboard: https://www.vice.com/en/article/how-ea-games-was-hacked-slack/
    { text: "In 2021 hackers bought a stolen login cookie for $10 and used it to get into Electronic Arts' Slack. They said they left with 780GB of data, including the source code for FIFA 21.", source: "https://www.vice.com/en/article/how-ea-games-was-hacked-slack/" },
    // Microsoft Security Blog: https://www.microsoft.com/en-us/security/blog/2023/07/14/analysis-of-storm-0558-techniques-for-unauthorized-email-access/
    { text: "In 2023 attackers who had obtained a Microsoft signing key forged their own login tokens. Microsoft said they used them to read email at about 25 organizations, including government agencies.", source: "https://www.microsoft.com/en-us/security/blog/2023/07/14/analysis-of-storm-0558-techniques-for-unauthorized-email-access/" },
  ],
  "authjs": [
    // Better Auth Blog: Auth.js is now part of Better Auth: https://better-auth.com/blog/authjs-joins-better-auth
    { text: "In September 2025 the team behind a newer rival, Better Auth, took over maintaining Auth.js. They said they would keep fixing security problems but suggested most new projects start with Better Auth.", source: "https://better-auth.com/blog/authjs-joins-better-auth" },
  ],
  "background-job": [
    // UK Financial Conduct Authority: https://www.fca.org.uk/news/press-releases/fca-fines-rbs-natwest-and-ulster-bank-ltd-%C2%A342-million-it-failures
    { text: "In June 2012 a failed upgrade to the software that updated accounts overnight at RBS, NatWest and Ulster Bank disrupted over 6.5 million customers for weeks. Regulators fined the banks £56 million.", source: "https://www.fca.org.uk/news/press-releases/fca-fines-rbs-natwest-and-ulster-bank-ltd-%C2%A342-million-it-failures" },
    // CBS News: https://www.cbsnews.com/news/santander-bank-seeks-to-recover-175-million-christmas-mistake
    { text: "On Christmas Day 2021 a scheduling problem made Santander UK send 75,000 payments twice. The bank paid out £130 million of its own money by mistake and had to try to get it back.", source: "https://www.cbsnews.com/news/santander-bank-seeks-to-recover-175-million-christmas-mistake" },
    // GitHub Blog: https://github.blog/2018-10-30-oct21-post-incident-analysis/
    { text: "In October 2018 a 43-second network break at GitHub led to 24 hours of degraded service. Background work piled up, with over 5 million webhook events and 80,000 site builds waiting in queues.", source: "https://github.blog/2018-10-30-oct21-post-incident-analysis/" },
  ],
  "browser-storage": [
    // VICE Motherboard: How Hackers Used Slack to Break into EA Games: https://www.vice.com/en/article/how-ea-games-was-hacked-slack/
    { text: "In 2021, hackers said they got into game maker EA starting with a stolen login cookie bought online for $10. They claimed to have taken 780 GB of data, including the source code of FIFA 21.", source: "https://www.vice.com/en/article/how-ea-games-was-hacked-slack/" },
    // Neowin: Linus Tech Tips YouTube channels were hacked due to a session hijacking attack: https://www.neowin.net/news/linus-tech-tips-youtube-channels-were-hacked-due-to-a-session-hijacking-attack/
    { text: "In March 2023, a fake sponsorship file sent to Linus Tech Tips copied the login cookies saved in an employee's browser. Attackers used them to take over the YouTube channels and post crypto scam videos.", source: "https://www.neowin.net/news/linus-tech-tips-youtube-channels-were-hacked-due-to-a-session-hijacking-attack/" },
    // WebKit Blog: Full Third-Party Cookie Blocking and More: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
    { text: "Since 2020, Safari has deleted everything a site saved with scripts, including localStorage, once the user goes seven days of browser use without interacting with that site. Data kept only in the browser can vanish.", source: "https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/" },
    // CircleCI: Incident report for January 4, 2023 security incident: https://circleci.com/blog/jan-4-2023-incident-report/
    { text: "In December 2022, malware on a CircleCI engineer's laptop stole a login cookie from a session that had already passed two-step sign-in. CircleCI had to tell customers to replace every secret stored with it.", source: "https://circleci.com/blog/jan-4-2023-incident-report/" },
  ],
  "caching": [
    // Valve statement (Steam): https://store.steampowered.com/news/19852/
    { text: "On Christmas Day 2015 a caching mistake at Steam showed pages meant for one user to other users for about 90 minutes. Around 34,000 users may have had details such as billing addresses seen by strangers.", source: "https://store.steampowered.com/news/19852/" },
    // OpenAI: https://openai.com/blog/march-20-chatgpt-outage
    { text: "On 20 March 2023 a bug in the library ChatGPT used to reach its cache showed some users the titles of other people's chats. Payment details of 1.2% of ChatGPT Plus subscribers may also have been exposed.", source: "https://openai.com/blog/march-20-chatgpt-outage" },
    // Slack Engineering: https://slack.engineering/slacks-incident-on-2-22-22/
    { text: "On 22 February 2022 a rollout at Slack replaced too many cache servers with empty ones. With little left in the cache, requests flooded the database and many users could not open Slack.", source: "https://slack.engineering/slacks-incident-on-2-22-22/" },
  ],
  "celery": [
    // Wikipedia: Celery (software): https://en.wikipedia.org/wiki/Celery_(software)
    { text: "Celery runs slow jobs in the background so a web page does not have to wait. Instagram has used Celery in production to process millions of tasks every day.", source: "https://en.wikipedia.org/wiki/Celery_(software)" },
  ],
  "clerk": [
    // Clerk Blog: Postmortem, Feb 6 2025 service outage: https://clerk.com/blog/postmortem-feb-6-2025-service-outage
    { text: "On February 6, 2025, one faulty database query at Clerk broke sign-in for about 3,700 of its customers at once. It took 26 minutes to undo.", source: "https://clerk.com/blog/postmortem-feb-6-2025-service-outage" },
  ],
  "client-server-boundary": [
    // Wiz Research: https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys
    { text: "In 2026 the vibe-coded site Moltbook left its database key in browser code with no access rules behind it. Researchers could read and change everything, including 1.5 million API tokens and 35,000 email addresses.", source: "https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys" },
    // Krebs on Security: https://krebsonsecurity.com/2021/10/missouri-governor-vows-to-prosecute-st-louis-post-dispatch-for-reporting-security-vulnerability/
    { text: "In 2021 a reporter found that a Missouri state website sent teachers' Social Security numbers inside its page source, with more than 100,000 exposed. Anyone could read them using the browser's view source option.", source: "https://krebsonsecurity.com/2021/10/missouri-governor-vows-to-prosecute-st-louis-post-dispatch-for-reporting-security-vulnerability/" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/over-3-200-apps-leak-twitter-api-keys-some-allowing-account-hijacks/
    { text: "The security firm CloudSEK found 3,207 mobile apps that shipped with their Twitter API keys inside. Anything packed into an app or web page can be pulled out by whoever downloads it.", source: "https://www.bleepingcomputer.com/news/security/over-3-200-apps-leak-twitter-api-keys-some-allowing-account-hijacks/" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/misconfigured-firebase-instances-leaked-19-million-plaintext-passwords/
    { text: "Researchers scanned over five million sites and found 916 whose Firebase databases anyone could read, because no rules were set on the server side. They exposed about 125 million user records and 19 million plain text passwords.", source: "https://www.bleepingcomputer.com/news/security/misconfigured-firebase-instances-leaked-19-million-plaintext-passwords/" },
  ],
  "container-image": [
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/17-backdoored-docker-images-removed-from-docker-hub/
    { text: "In 2018 Docker removed 17 images with hidden backdoors that one account had kept on Docker Hub for about a year. Some had over a million installs, and one scheme mined about $90,000 of cryptocurrency.", source: "https://www.bleepingcomputer.com/news/security/17-backdoored-docker-images-removed-from-docker-hub/" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/thousands-of-images-on-docker-hub-leak-auth-secrets-private-keys/
    { text: "University researchers studied 337,171 images from Docker Hub and found that about 8.5% contained secrets. They uncovered 52,107 valid private keys and 3,158 API secrets left inside public images.", source: "https://www.bleepingcomputer.com/news/security/thousands-of-images-on-docker-hub-leak-auth-secrets-private-keys/" },
    // Codecov security update: https://about.codecov.io/security-update/
    { text: "In 2021 a mistake in how Codecov built its Docker image let an attacker extract a credential. For two months the attacker used it to alter a script so it sent customers' secrets to an outside server.", source: "https://about.codecov.io/security-update/" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/over-10-000-docker-hub-images-found-leaking-credentials-auth-keys/
    { text: "Security firm Flare scanned the images uploaded to Docker Hub in a single month and found 10,456 that exposed keys. About 4,000 of those keys were access tokens for AI models.", source: "https://www.bleepingcomputer.com/news/security/over-10-000-docker-hub-images-found-leaking-credentials-auth-keys/" },
    // Sysdig Threat Research: https://sysdig.com/blog/analysis-of-supply-chain-attacks-through-public-docker-images/
    { text: "Security firm Sysdig analysed over 250,000 public Docker images and found 1,652 that were malicious. The most common kind secretly mined cryptocurrency on whatever machine ran the image.", source: "https://sysdig.com/blog/analysis-of-supply-chain-attacks-through-public-docker-images/" },
  ],
  "cors": [
    // PortSwigger Research: https://portswigger.net/research/exploiting-cors-misconfigurations-for-bitcoins-and-bounties
    { text: "A researcher found a bitcoin exchange whose CORS setup trusted any website. A malicious page could have stolen logged-in users' private API keys and moved their funds, and the fix took 20 minutes.", source: "https://portswigger.net/research/exploiting-cors-misconfigurations-for-bitcoins-and-bounties" },
    // Oligo Security: https://www.oligo.security/blog/0-0-0-0-day-exploiting-localhost-apis-from-the-browser
    { text: "In 2024 researchers showed that websites could reach programs running on a visitor's own Mac or Linux computer through the address 0.0.0.0, in every major browser. The first bug report about it was 18 years old.", source: "https://www.oligo.security/blog/0-0-0-0-day-exploiting-localhost-apis-from-the-browser" },
  ],
  "css-layout": [
    // web.dev: Yahoo! JAPAN News case study: https://web.dev/case-studies/yahoo-japan-news
    { text: "Yahoo Japan News fixed parts of its pages that jumped around while loading. Page views per visit rose 15.1% and visits lasted 13.3% longer.", source: "https://web.dev/case-studies/yahoo-japan-news" },
    // web.dev: The business impact of Core Web Vitals: https://web.dev/case-studies/vitals-business-impact
    { text: "Recipe site iCook reduced how much its page layout shifted during loading by 15%. Its ad revenue went up 10%.", source: "https://web.dev/case-studies/vitals-business-impact" },
    // web.dev: The business impact of Core Web Vitals: https://web.dev/case-studies/vitals-business-impact
    { text: "Comic site Ameba Manga made its page layout 10 times more stable while loading. The number of comics people read went up 2 to 3 times.", source: "https://web.dev/case-studies/vitals-business-impact" },
    // web.dev: The business impact of Core Web Vitals: https://web.dev/case-studies/vitals-business-impact
    { text: "Italian publisher GEDI cut layout shift on its pages by 77%. The share of visitors who left straight away fell by 8%.", source: "https://web.dev/case-studies/vitals-business-impact" },
  ],
  "db-schema": [
    // GitHub Availability Report: November 2021: https://github.blog/2021-12-01-github-availability-report-november-2021/
    { text: "On 27 November 2021 a schema migration on one large table at GitHub locked up its database copies during the final rename step. Core GitHub services were degraded for 2 hours 50 minutes.", source: "https://github.blog/2021-12-01-github-availability-report-november-2021/" },
    // Resend incident report: https://resend.com/blog/incident-report-for-february-21-2024
    { text: "In February 2024 an engineer at email service Resend ran a database migration that pointed at production by mistake and dropped every table. Customers could not send email for about 12 hours.", source: "https://resend.com/blog/incident-report-for-february-21-2024" },
    // Basecamp postmortem (Signal v. Noise): https://signalvnoise.com/svn3/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/
    { text: "In November 2018 the ID column in Basecamp's busiest table hit 2,147,483,647, the largest number its type could hold. Basecamp 3 was stuck in read-only mode for almost five hours.", source: "https://signalvnoise.com/svn3/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/" },
  ],
  "db-transaction": [
    // PCWorld: https://www.pcworld.com/article/444202/withdrawal-vulnerabilities-enabled-bitcoin-theft-from-flexcoin-and-poloniex.html
    { text: "In March 2014 a thief sent thousands of transfer requests at once to the bitcoin bank Flexcoin, before balances could update. 896 bitcoins worth about $600,000 were taken and Flexcoin closed down.", source: "https://www.pcworld.com/article/444202/withdrawal-vulnerabilities-enabled-bitcoin-theft-from-flexcoin-and-poloniex.html" },
    // Sakurity blog (Egor Homakov): https://sakurity.com/blog/2015/05/21/starbucks.html
    { text: "In 2015 a researcher sent two transfer requests at the same instant between Starbucks gift cards, and the same $5 moved twice. He turned $15 of cards into $20 and reported the flaw.", source: "https://sakurity.com/blog/2015/05/21/starbucks.html" },
    // PCWorld: https://www.pcworld.com/article/444202/withdrawal-vulnerabilities-enabled-bitcoin-theft-from-flexcoin-and-poloniex.html
    { text: "In March 2014 a thief placed several withdrawals at the same instant on the exchange Poloniex, pushing a balance below zero. Poloniex lost 12.3 percent of its funds because nothing checked for it.", source: "https://www.pcworld.com/article/444202/withdrawal-vulnerabilities-enabled-bitcoin-theft-from-flexcoin-and-poloniex.html" },
  ],
  "dependency-added": [
    // Wikipedia: npm left-pad incident: https://en.wikipedia.org/wiki/Npm_left-pad_incident
    { text: "In March 2016 a developer removed his 11-line package, left-pad, from npm. Projects that depended on it, including React and Babel, could not be built until npm restored it two hours later.", source: "https://en.wikipedia.org/wiki/Npm_left-pad_incident" },
    // Wikipedia: XZ Utils backdoor: https://en.wikipedia.org/wiki/XZ_Utils_backdoor
    { text: "In March 2024 a hidden backdoor was found in xz, a compression tool that many Linux systems include. It was planted by a contributor who had spent over two years earning the project's trust.", source: "https://en.wikipedia.org/wiki/XZ_Utils_backdoor" },
    // Wikipedia: Log4Shell: https://en.wikipedia.org/wiki/Log4Shell
    { text: "In December 2021 a flaw became public in Log4j, a logging library built into a huge number of Java programs. It had gone unnoticed since 2013 and was rated 10 out of 10 for severity.", source: "https://en.wikipedia.org/wiki/Log4Shell" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/dev-corrupts-npm-libs-colors-and-faker-breaking-thousands-of-apps/
    { text: "In January 2022 the author of colors, an npm package downloaded over 20 million times a week, released a version with an endless loop on purpose. Apps that used it printed gibberish without stopping.", source: "https://www.bleepingcomputer.com/news/security/dev-corrupts-npm-libs-colors-and-faker-breaking-thousands-of-apps/" },
    // Wikipedia: 2017 Equifax data breach: https://en.wikipedia.org/wiki/2017_Equifax_data_breach
    { text: "In 2017 attackers got into Equifax through Apache Struts, a library its website used, about two months after a fix came out. Private records of 147.9 million Americans were taken.", source: "https://en.wikipedia.org/wiki/2017_Equifax_data_breach" },
    // Snyk Blog: https://snyk.io/blog/a-post-mortem-of-the-malicious-event-stream-backdoor/
    { text: "In 2018 the maintainer of the npm package event-stream handed it over to a stranger who offered to help. The stranger added code that stole bitcoin, and it was downloaded millions of times.", source: "https://snyk.io/blog/a-post-mortem-of-the-malicious-event-stream-backdoor/" },
  ],
  "django": [
    // Wikipedia: Django (web framework): https://en.wikipedia.org/wiki/Django_(web_framework)
    { text: "Django was built in 2003 by web programmers at a newspaper, the Lawrence Journal-World. They named it after the jazz guitarist Django Reinhardt and released it to the public in 2005.", source: "https://en.wikipedia.org/wiki/Django_(web_framework)" },
  ],
  "docker": [
    // Wikipedia: Docker (software): https://en.wikipedia.org/wiki/Docker_(software)
    { text: "Docker started as an internal project at a hosting company called dotCloud and was first shown to the public at the PyCon conference in 2013. The company renamed itself Docker Inc that same year.", source: "https://en.wikipedia.org/wiki/Docker_(software)" },
    // SecurityWeek: Docker Hub Breach Hits 190,000 Accounts: https://www.securityweek.com/docker-hub-breach-hits-190000-accounts/
    { text: "In April 2019 an attacker broke into a Docker Hub database holding data for about 190,000 accounts. It exposed some usernames and password hashes, plus GitHub and Bitbucket tokens used for automatic builds.", source: "https://www.securityweek.com/docker-hub-breach-hits-190000-accounts/" },
  ],
  "drizzle": [
    // PlanetScale blog: Drizzle joins PlanetScale: https://planetscale.com/blog/drizzle-joins-planetscale
    { text: "In March 2026, the database company PlanetScale hired the whole team behind Drizzle ORM. Both sides said Drizzle would stay an independent open source project with its own roadmap.", source: "https://planetscale.com/blog/drizzle-joins-planetscale" },
  ],
  "env-vars": [
    // Palo Alto Networks Unit 42: https://unit42.paloaltonetworks.com/large-scale-cloud-extortion-operation/
    { text: "Attackers hunted for .env files left reachable on websites and targeted 110,000 domains. They collected over 90,000 variables, including 7,000 cloud access keys, then emptied victims' cloud storage and left ransom notes.", source: "https://unit42.paloaltonetworks.com/large-scale-cloud-extortion-operation/" },
    // Codecov security update: https://about.codecov.io/security-update/
    { text: "From January 31 to April 1, 2021, a tampered Codecov script could quietly send customers' environment variables to an outside server. It was caught when one customer noticed the file's checksum did not match.", source: "https://about.codecov.io/security-update/" },
    // Vercel security bulletin: https://vercel.com/kb/bulletin/vercel-april-2026-security-incident
    { text: "In April 2026 an attacker inside Vercel's systems read customers' environment variables that had not been marked sensitive. Vercel told those customers to replace API keys, tokens and database passwords.", source: "https://vercel.com/kb/bulletin/vercel-april-2026-security-incident" },
    // CircleCI incident report: https://circleci.com/blog/jan-4-2023-incident-report/
    { text: "In December 2022 an attacker inside CircleCI's systems copied customers' environment variables, tokens and keys. CircleCI told customers to assume every secret stored there had been seen and to replace them all.", source: "https://circleci.com/blog/jan-4-2023-incident-report/" },
  ],
  "error-handling": [
    // Cloudflare Blog: https://blog.cloudflare.com/18-november-2025-outage/
    { text: "On 18 November 2025 a settings file at Cloudflare grew to twice its normal size, and the code reading it crashed instead of coping. Sites behind Cloudflare returned errors for nearly 6 hours.", source: "https://blog.cloudflare.com/18-november-2025-outage/" },
    // Wikipedia: USS Yorktown (CG-48): https://en.wikipedia.org/wiki/USS_Yorktown_(CG-48)
    { text: "In 1997 a crew member typed a zero into a database on the US Navy ship USS Yorktown. The software tried to divide by it and crashed, and the warship sat dead in the water for 2 hours 45 minutes.", source: "https://en.wikipedia.org/wiki/USS_Yorktown_(CG-48)" },
    // Google Cloud Service Health incident report: https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW
    { text: "On 12 June 2025 new code at Google Cloud met blank fields it had no error handling for and crashed. More than 50 Google services were disrupted, some for hours.", source: "https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW" },
    // NATS (passenger figure: UK Civil Aviation Authority review): https://www.nats.aero/news/nats-report-into-air-traffic-control-incident-details-root-cause-and-solution-implemented/
    { text: "In August 2023 one flight plan with two waypoints of the same name made the UK flight planning system and its backup both stop. Over 700,000 passengers were affected.", source: "https://www.nats.aero/news/nats-report-into-air-traffic-control-incident-details-root-cause-and-solution-implemented/" },
  ],
  "eslint": [
    // ESLint Blog: Postmortem for Malicious Packages Published on July 12th, 2018: https://eslint.org/blog/2018/07/postmortem-for-malicious-package-publishes/
    { text: "In July 2018 an attacker got into an ESLint maintainer's npm account, which reused a password and had no two-factor login. The fake releases they published stole npm login tokens from anyone who installed them.", source: "https://eslint.org/blog/2018/07/postmortem-for-malicious-package-publishes/" },
  ],
  "express": [
    // Express Blog: Introducing Express v5: https://expressjs.com/en/blog/2024-10-15-v5-release
    { text: "The pull request for Express version 5 was opened in July 2014. It was finally merged and released in October 2024, about ten years later.", source: "https://expressjs.com/en/blog/2024-10-15-v5-release" },
  ],
  "fastapi": [
    // JetBrains / Python Software Foundation: Python Developers Survey 2024: https://lp.jetbrains.com/python-developers-survey-2024/
    { text: "In an official survey of more than 25,000 Python developers, FastAPI use jumped from 29% in 2023 to 38% in 2024. That put it ahead of both Django and Flask.", source: "https://lp.jetbrains.com/python-developers-survey-2024/" },
  ],
  "file-upload": [
    // Wikipedia: Zip bomb: https://en.wikipedia.org/wiki/Zip_bomb
    { text: "A well-known file called 42.zip is only 42 kilobytes, yet it unpacks to about 4.5 petabytes, which is millions of gigabytes. A server that unzips uploads without a size limit can be filled by one tiny file.", source: "https://en.wikipedia.org/wiki/Zip_bomb" },
    // Rapid7: https://www.rapid7.com/blog/post/2021/11/01/gitlab-unauthenticated-remote-code-execution-cve-2021-22205-exploited-in-the-wild/
    { text: "A 2021 GitLab flaw let an attacker run commands on a server just by uploading a crafted image file. Researchers then found about half of nearly 60,000 internet-facing GitLab servers still unpatched.", source: "https://www.rapid7.com/blog/post/2021/11/01/gitlab-unauthenticated-remote-code-execution-cve-2021-22205-exploited-in-the-wild/" },
    // Sucuri Blog: https://blog.sucuri.net/2020/09/critical-vulnerability-file-manager-affecting-700k-wordpress-websites.html
    { text: "In 2020 a WordPress plugin installed on about 700,000 sites let any visitor upload files without logging in, enough to take over a site. One security firm saw attacks peak at over 10,000 an hour.", source: "https://blog.sucuri.net/2020/09/critical-vulnerability-file-manager-affecting-700k-wordpress-websites.html" },
  ],
  "firebase": [
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/misconfigured-firebase-instances-leaked-19-million-plaintext-passwords/
    { text: "In 2024, three researchers scanned the web and found 916 sites with Firebase security rules missing or set up wrong. Those sites exposed about 125 million user records and 19 million plain text passwords.", source: "https://www.bleepingcomputer.com/news/security/misconfigured-firebase-instances-leaked-19-million-plaintext-passwords/" },
    // Engadget: https://www.engadget.com/cybersecurity/tea-app-suffers-breach-exposing-thousands-of-user-images-190731414.html
    { text: "In 2025, about 72,000 images from the dating safety app Tea leaked, including selfies and photo IDs. The files had been sitting in an exposed Firebase storage bucket.", source: "https://www.engadget.com/cybersecurity/tea-app-suffers-breach-exposing-thousands-of-user-images-190731414.html" },
    // Wikipedia: Firebase: https://en.wikipedia.org/wiki/Firebase
    { text: "Firebase grew out of a chat tool called Envolve. Its founders noticed developers were using the chat to pass around things like game state instead of messages, so they built a product just for that.", source: "https://en.wikipedia.org/wiki/Firebase" },
    // The Register: https://www.theregister.com/2020/12/10/google_cloud_over_run/
    { text: "In 2020, a startup's test app made 116 billion reads to its Firebase database overnight. The bill came to almost $72,000 despite a $7 budget, and Google later waived it as a one-time gesture.", source: "https://www.theregister.com/2020/12/10/google_cloud_over_run/" },
  ],
  "github-actions": [
    // GitHub Blog: GitHub Actions update: Helping maintainers combat bad actors: https://github.blog/open-source/maintainers/github-actions-update-helping-maintainers-combat-bad-actors/
    { text: "In 2021 people abused GitHub Actions to mine cryptocurrency by opening pull requests on other people's projects. Since then, a maintainer must approve workflow runs from first-time contributors.", source: "https://github.blog/open-source/maintainers/github-actions-update-helping-maintainers-combat-bad-actors/" },
    // StepSecurity: tj-actions/changed-files action is compromised: https://www.stepsecurity.io/blog/harden-runner-detection-tj-actions-changed-files-action-is-compromised
    { text: "In March 2025 a GitHub Actions add-on called tj-actions/changed-files, used in over 23,000 repositories, was hijacked. It printed projects' secret keys into their build logs.", source: "https://www.stepsecurity.io/blog/harden-runner-detection-tj-actions-changed-files-action-is-compromised" },
  ],
  "gitignore": [
    // US Federal Trade Commission: https://www.ftc.gov/news-events/news/press-releases/2018/04/uber-agrees-expanded-settlement-ftc-related-privacy-security-claims
    { text: "In 2016 intruders used an access key that an Uber engineer had posted on a code-sharing site to reach data on over 25 million users. Uber paid them $100,000 and did not disclose it until late 2017.", source: "https://www.ftc.gov/news-events/news/press-releases/2018/04/uber-agrees-expanded-settlement-ftc-related-privacy-security-claims" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/toyota-discloses-data-leak-after-access-key-exposed-on-github/
    { text: "In 2022 Toyota found that a secret access key had sat in a public GitHub repository for almost five years. It put the email addresses of 296,019 customers at risk.", source: "https://www.bleepingcomputer.com/news/security/toyota-discloses-data-leak-after-access-key-exposed-on-github/" },
    // Wiz Research: https://www.wiz.io/blog/38-terabytes-of-private-data-accidentally-exposed-by-microsoft-ai-researchers
    { text: "In 2023 researchers found an access link in a public Microsoft GitHub repository that opened 38 terabytes of private data. It included over 30,000 internal Teams messages and staff passwords.", source: "https://www.wiz.io/blog/38-terabytes-of-private-data-accidentally-exposed-by-microsoft-ai-researchers" },
    // The Register: https://www.theregister.com/2017/11/14/dxc_github_aws_keys_leaked/
    { text: "In 2017 code containing AWS keys was put in a public GitHub repository at the tech firm DXC. Within four days strangers used the keys to start 244 cloud servers and ran up a $64,000 bill.", source: "https://www.theregister.com/2017/11/14/dxc_github_aws_keys_leaked/" },
    // GitGuardian: The State of Secrets Sprawl 2025: https://blog.gitguardian.com/the-state-of-secrets-sprawl-2025/
    { text: "Security firm GitGuardian counted 23.8 million secrets, such as passwords and API keys, leaked in public GitHub repositories in 2024. It found that 70% of the secrets leaked in 2022 still worked.", source: "https://blog.gitguardian.com/the-state-of-secrets-sprawl-2025/" },
    // Vladimir Smitka: Global scan of exposed .git: https://smitka.me/open-git/
    { text: "In 2018 a researcher scanned 230 million websites and found 390,000 with their .git folder open to anyone. That folder can reveal a site's source code and any passwords stored in it.", source: "https://smitka.me/open-git/" },
  ],
  "hardcoded-secret": [
    // FTC press release: https://www.ftc.gov/news-events/news/press-releases/2018/04/uber-agrees-expanded-settlement-ftc-related-privacy-security-claims
    { text: "In 2016 intruders used an access key that an Uber engineer had posted on a code-sharing site to download details of more than 25 million riders and drivers. Uber paid the intruders $100,000.", source: "https://www.ftc.gov/news-events/news/press-releases/2018/04/uber-agrees-expanded-settlement-ftc-related-privacy-security-claims" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/toyota-discloses-data-leak-after-access-key-exposed-on-github/
    { text: "Toyota said in 2022 that an access key had sat in public code on GitHub for almost five years. The key opened a server holding the email addresses of 296,019 customers.", source: "https://www.bleepingcomputer.com/news/security/toyota-discloses-data-leak-after-access-key-exposed-on-github/" },
    // GitGuardian State of Secrets Sprawl 2025: https://www.gitguardian.com/state-of-secrets-sprawl-report-2025
    { text: "A security firm counted more than 23 million new passwords and keys written into public code on GitHub in 2024 alone. It also found that 70% of the secrets leaked in 2022 still worked.", source: "https://www.gitguardian.com/state-of-secrets-sprawl-report-2025" },
    // Krebs on Security: https://krebsonsecurity.com/2025/05/xai-dev-leaks-api-key-for-private-spacex-tesla-llms/
    { text: "In 2025 an xAI employee published code on GitHub with an API key inside. The key stayed exposed for about two months and opened at least 60 private AI models, some tuned on SpaceX and Tesla data.", source: "https://krebsonsecurity.com/2025/05/xai-dev-leaks-api-key-for-private-spacex-tesla-llms/" },
  ],
  "hono": [
    // Hono Docs: Philosophy: https://hono.dev/docs/concepts/motivation
    { text: "Hono means flame in Japanese. Its author started it because he wanted to build an app on Cloudflare Workers and found no good framework that ran there.", source: "https://hono.dev/docs/concepts/motivation" },
  ],
  "http-fetch": [
    // AWS post-event summary: https://aws.amazon.com/message/41926/
    { text: "On 28 February 2017 a mistyped command took Amazon's S3 storage offline for about 4 hours. Amazon could not update its own status page for much of that time, because the page depended on S3.", source: "https://aws.amazon.com/message/41926/" },
    // Fastly Blog: https://www.fastly.com/blog/summary-of-june-8-outage
    { text: "On 8 June 2021 one customer's valid settings change triggered a bug at Fastly, and 85% of its network returned errors. Websites that relied on Fastly to deliver their pages failed along with it.", source: "https://www.fastly.com/blog/summary-of-june-8-outage" },
    // Cloudflare Blog: https://blog.cloudflare.com/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage/
    { text: "On 12 September 2025 a bug in Cloudflare's dashboard made it call one internal API over and over. The repeat calls overwhelmed that service, and the dashboard was unavailable for about an hour.", source: "https://blog.cloudflare.com/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage/" },
    // AWS post-event summary: https://aws.amazon.com/message/12721/
    { text: "On 7 December 2021 a surge of connections overwhelmed part of AWS's internal network, and clients kept retrying. The retries added to the jam, and the congestion lasted about 7 hours.", source: "https://aws.amazon.com/message/12721/" },
    // Wikipedia: DDoS attacks on Dyn: https://en.wikipedia.org/wiki/DDoS_attacks_on_Dyn
    { text: "On 21 October 2016 an attack on one DNS company, Dyn, made Twitter, Netflix, Spotify, Reddit and many other sites unreachable. Their own servers were running, but all of them depended on Dyn.", source: "https://en.wikipedia.org/wiki/DDoS_attacks_on_Dyn" },
  ],
  "input-validation": [
    // Wikipedia: Heartbleed: https://en.wikipedia.org/wiki/Heartbleed
    { text: "The 2014 Heartbleed bug came from one missing length check on incoming data, and about 17% of secure web servers were open to it. Thieves used it to take about 900 social insurance numbers from Canada's tax agency.", source: "https://en.wikipedia.org/wiki/Heartbleed" },
    // Wikipedia: USS Yorktown (CG-48): https://en.wikipedia.org/wiki/USS_Yorktown_(CG-48)
    { text: "In 1997 a crew member on the US Navy ship Yorktown typed a zero into a database field. The software tried to divide by it, the network went down, and the ship sat dead in the water for about 2 hours 45 minutes.", source: "https://en.wikipedia.org/wiki/USS_Yorktown_(CG-48)" },
    // The Register: https://www.theregister.com/2024/08/07/crowdstrike_full_incident_root_cause_analysis/
    { text: "In July 2024 a CrowdStrike update supplied 20 input values to code that expected 21, and the checking step missed it. About 8.5 million Windows computers crashed.", source: "https://www.theregister.com/2024/08/07/crowdstrike_full_incident_root_cause_analysis/" },
    // Graham Cluley: https://www.grahamcluley.com/null-vanity-plate-hack-to-dodge-parking-tickets-backfires-to-the-tune-of-12000
    { text: "A security researcher registered the license plate NULL as a joke. The ticket database then tied him to every ticket that had no plate number on file, and his fines reached $12,049.", source: "https://www.grahamcluley.com/null-vanity-plate-hack-to-dodge-parking-tickets-backfires-to-the-tune-of-12000" },
  ],
  "jest": [
    // Engineering at Meta: Meta Open Source is transferring Jest to the OpenJS Foundation: https://engineering.fb.com/2022/05/11/open-source/jest-openjs-foundation/
    { text: "Jest began at Facebook in 2011, when the site's chat feature was rewritten in JavaScript and the team needed fast tests. By 2022 it had over 17 million weekly downloads.", source: "https://engineering.fb.com/2022/05/11/open-source/jest-openjs-foundation/" },
    // Engineering at Meta: Meta Open Source is transferring Jest to the OpenJS Foundation: https://engineering.fb.com/2022/05/11/open-source/jest-openjs-foundation/
    { text: "In May 2022 Meta gave Jest away to the OpenJS Foundation. Since 2018, almost all the work on Jest had already come from people outside Meta.", source: "https://engineering.fb.com/2022/05/11/open-source/jest-openjs-foundation/" },
  ],
  "mongoose": [
    // Trend Micro: https://www.trendmicro.com/vinfo/us/security/news/cybercrime-and-digital-threats/hacking-groups-attack-more-than-20-thousand-mongodb-databases
    { text: "Mongoose connects your app to a MongoDB database, and that database needs a password. In 2017, attackers wiped more than 20,000 MongoDB databases left open with default settings and demanded ransom.", source: "https://www.trendmicro.com/vinfo/us/security/news/cybercrime-and-digital-threats/hacking-groups-attack-more-than-20-thousand-mongodb-databases" },
  ],
  "openai-sdk": [
    // GitGuardian Blog: The State of Secrets Sprawl 2024: https://blog.gitguardian.com/the-state-of-secrets-sprawl-2024/
    { text: "The security firm GitGuardian found that leaks of OpenAI API keys in public code on GitHub grew 1,212 times over between 2022 and 2023.", source: "https://blog.gitguardian.com/the-state-of-secrets-sprawl-2024/" },
    // OpenAI Help Center: Best Practices for API Key Safety: https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety
    { text: "OpenAI's own safety guide says never to put an API key in browser or mobile app code. Anyone who finds the key can use your account's quota, which may lead to charges you did not expect.", source: "https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety" },
  ],
  "orm-query": [
    // Cloudflare Blog: https://blog.cloudflare.com/18-november-2025-outage/
    { text: "On 18 November 2025 a database query at Cloudflare began returning duplicate rows after a permissions change. The oversized file built from it broke Cloudflare's network for nearly 6 hours.", source: "https://blog.cloudflare.com/18-november-2025-outage/" },
    // KeepTheScore founder's blog: https://casparwre.de/blog/deleting-the-production-database/
    { text: "In October 2020 the founder of KeepTheScore ran a reset script that connected to the live database instead of his local one. Over 300,000 scoreboards were wiped and 7 hours of data were lost for good.", source: "https://casparwre.de/blog/deleting-the-production-database/" },
    // Percona Blog: https://www.percona.com/blog/2017/03/06/mysql-i-am-a-dummy/
    { text: "MySQL has a real option named --i-am-a-dummy. It blocks UPDATE and DELETE commands that have no WHERE clause, and was added for people who once emptied a table by forgetting it.", source: "https://www.percona.com/blog/2017/03/06/mysql-i-am-a-dummy/" },
  ],
  "pagination": [
    // Krebs on Security: https://krebsonsecurity.com/2019/05/first-american-financial-corp-leaked-hundreds-of-millions-of-title-insurance-records/
    { text: "In 2019 First American's website exposed about 885 million property records. Anyone with one valid link could view other people's documents by changing a single digit, with no login.", source: "https://krebsonsecurity.com/2019/05/first-american-financial-corp-leaked-hundreds-of-millions-of-title-insurance-records/" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/dell-api-abused-to-steal-49-million-customer-records-in-data-breach/
    { text: "In 2024 an attacker said he collected 49 million Dell customer records by sending 5,000 requests a minute for three weeks. He said the portal had no limit on how fast records could be requested.", source: "https://www.bleepingcomputer.com/news/security/dell-api-abused-to-steal-49-million-customer-records-in-data-breach/" },
    // TechCrunch: https://techcrunch.com/2019/06/16/millions-venmo-transactions-scraped/
    { text: "In 2019 a student downloaded 7 million Venmo payments through its public API, at about 57,600 a day. The limit on each request did not stop one person from collecting the records in bulk.", source: "https://techcrunch.com/2019/06/16/millions-venmo-transactions-scraped/" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/email-addresses-of-15-million-trello-users-leaked-on-hacking-forum/
    { text: "In January 2024 someone fed 500 million email addresses into an open Trello API to see which had accounts. Profiles of more than 15 million users were later posted on a hacking forum.", source: "https://www.bleepingcomputer.com/news/security/email-addresses-of-15-million-trello-users-leaked-on-hacking-forum/" },
  ],
  "password-hashing": [
    // Wikipedia: RockYou: https://en.wikipedia.org/wiki/RockYou
    { text: "In 2009 a hacker broke into the app maker RockYou and found more than 32 million passwords stored as plain text. Hashing would have left the thief with scrambled values instead of working passwords.", source: "https://en.wikipedia.org/wiki/RockYou" },
    // Wikipedia: 2012 LinkedIn hack: https://en.wikipedia.org/wiki/2012_LinkedIn_hack
    { text: "In 2012 password hashes for nearly 6.5 million LinkedIn accounts were stolen. They had been hashed without a salt, so attackers could reverse many of them quickly using ready-made lookup tables.", source: "https://en.wikipedia.org/wiki/2012_LinkedIn_hack" },
    // Irish Data Protection Commission: https://www.dataprotection.ie/en/news-media/press-releases/DPC-announces-91-million-fine-of-Meta
    { text: "In 2024 Ireland's privacy regulator fined Meta €91 million for storing some users' passwords as plain text on its internal systems. No outsider got them; keeping them unhashed was the offense.", source: "https://www.dataprotection.ie/en/news-media/press-releases/DPC-announces-91-million-fine-of-Meta" },
    // Wikipedia: Ashley Madison data breach: https://en.wikipedia.org/wiki/Ashley_Madison_data_breach
    { text: "Ashley Madison hashed its passwords with strong bcrypt, but a design flaw also hashed them with weak MD5. After its data breach, that one slip let 11 million passwords be cracked.", source: "https://en.wikipedia.org/wiki/Ashley_Madison_data_breach" },
  ],
  "playwright": [
    // Wikipedia: Playwright (software): https://en.wikipedia.org/wiki/Playwright_(software)
    { text: "Playwright was launched by Microsoft in January 2020. Some of the engineers who built it had earlier worked on Puppeteer, a similar browser tool, at Google.", source: "https://en.wikipedia.org/wiki/Playwright_(software)" },
    // Playwright Docs: Browsers: https://playwright.dev/docs/browsers
    { text: "Playwright does not drive the normal Firefox or Safari on your computer. It downloads its own browser builds, because it relies on patches that the branded versions do not have.", source: "https://playwright.dev/docs/browsers" },
  ],
  "posthog": [
    // PostHog Handbook: Our story: https://posthog.com/handbook/story
    { text: "PostHog was its founders' sixth idea in about six months of changing direction roughly once a month. The first version shipped about four weeks after they started writing its code in 2020.", source: "https://posthog.com/handbook/story" },
  ],
  "prettier": [
    // Prettier Blog: $20k Bounty was Claimed: https://prettier.io/blog/2023/11/27/20k-bounty-was-claimed
    { text: "In November 2023 Prettier offered a $20,000 prize for a Rust formatter that passed 95% of its tests. The Biome project claimed it in about three weeks.", source: "https://prettier.io/blog/2023/11/27/20k-bounty-was-claimed" },
  ],
  "prisma": [
    // Prisma blog: ORM 6.15.0, AI Safety Guardrails for Destructive Commands: https://www.prisma.io/blog/orm-6-15-0-ai-safety-guardrails-for-destructive-commands-and-more
    { text: "In August 2025, Prisma added a safety check for AI coding tools. When Claude Code, Cursor or Replit tries to run the Prisma command that wipes a database, it now stops and asks the human first.", source: "https://www.prisma.io/blog/orm-6-15-0-ai-safety-guardrails-for-destructive-commands-and-more" },
    // Prisma blog: Stop your AI agent dropping your database: https://www.prisma.io/blog/stop-your-ai-agent-dropping-your-database
    { text: "Prisma's team wrote in 2026 that Prisma 8 has no reset command and no \"delete the database\" command at all. The same post listed real cases of AI agents wiping live databases.", source: "https://www.prisma.io/blog/stop-your-ai-agent-dropping-your-database" },
  ],
  "pydantic": [
    // Pydantic documentation: https://pydantic.dev/docs/validation/latest/get-started/
    { text: "Pydantic's docs say it is downloaded more than 550 million times a month and used by 20 of the 25 largest companies on the NASDAQ. The part that checks your data is written in Rust.", source: "https://pydantic.dev/docs/validation/latest/get-started/" },
    // Pydantic: About: https://pydantic.dev/about
    { text: "Pydantic's creator, Samuel Colvin, said he started it out of frustration that Python type hints do nothing while a program runs. He was curious whether they could be used to check data.", source: "https://pydantic.dev/about" },
  ],
  "pytest": [
    // Wikipedia: Pytest: https://en.wikipedia.org/wiki/Pytest
    { text: "pytest grew out of PyPy, a project to rebuild Python itself. Its testing tool was named py.test in 2004 and only became a separate package called pytest in 2010.", source: "https://en.wikipedia.org/wiki/Pytest" },
  ],
  "rate-limiting": [
    // TechCrunch: https://techcrunch.com/2024/05/10/threat-actor-scraped-49m-dell-customer-addresses-before-the-company-found-out/
    { text: "In 2024 a person said he collected 49 million Dell customer records by sending more than 5,000 requests a minute to one Dell page for nearly three weeks. In his words, Dell did not notice anything.", source: "https://techcrunch.com/2024/05/10/threat-actor-scraped-49m-dell-customer-addresses-before-the-company-found-out/" },
    // The Zero Hack (researcher's write-up): https://thezerohack.com/hack-any-instagram
    { text: "A researcher showed he could get past Instagram's rate limit and try all one million 6-digit password reset codes by spreading the guesses over many IP addresses. Facebook paid him $30,000 for the report.", source: "https://thezerohack.com/hack-any-instagram" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/trello-api-abused-to-link-email-addresses-to-15-million-accounts/
    { text: "In 2024 someone fed 500 million email addresses into a Trello lookup and matched 15 million of them to accounts. The limit counted requests per IP address, so the person just rotated through proxy servers.", source: "https://www.bleepingcomputer.com/news/security/trello-api-abused-to-link-email-addresses-to-15-million-accounts/" },
    // The Register: https://www.theregister.com/2020/12/10/google_cloud_over_run/
    { text: "In 2020 a startup testing on Google Cloud with a $7 budget got a bill of almost $72,000 after buggy code kept calling itself overnight. The budget was only an alert, and nothing capped how much the code could run.", source: "https://www.theregister.com/2020/12/10/google_cloud_over_run/" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/security/hackers-abused-api-to-verify-millions-of-authy-mfa-phone-numbers/
    { text: "In 2024 attackers fed a huge list of phone numbers into a Twilio Authy endpoint that needed no login and answered every request. They confirmed about 33 million numbers that belonged to Authy users.", source: "https://www.bleepingcomputer.com/news/security/hackers-abused-api-to-verify-millions-of-authy-mfa-phone-numbers/" },
  ],
  "react-effect": [
    // Cloudflare Blog: Deep dive into Cloudflare's Sept 12 dashboard and API outage: https://blog.cloudflare.com/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage/
    { text: "In September 2025, a React effect in Cloudflare's dashboard re-ran far too often because of one wrong item in its dependency list. It flooded Cloudflare's own API with requests and helped cause an outage of over an hour.", source: "https://blog.cloudflare.com/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage/" },
    // DEV Community: first-hand account by Adam Knox: https://dev.to/adamwknox/i-made-a-mistake-implementing-a-react-hook-and-got-a-denial-of-service-from-my-backend-5cji
    { text: "One developer left the dependency list off a React effect, so it ran after every render and fetched data in a loop. It used up Firebase's free daily limit of 50,000 reads in a few minutes.", source: "https://dev.to/adamwknox/i-made-a-mistake-implementing-a-react-hook-and-got-a-denial-of-service-from-my-backend-5cji" },
    // Google Cloud Blog: How to avoid a self-inflicted DDoS attack: https://cloud.google.com/blog/products/gcp/how-to-avoid-a-self-inflicted-ddos-attack-cre-life-lessons
    { text: "Google engineers found that copies of an app, each asking the server for updates every 5 minutes, had drifted into step over many months. Peak load reached 3 times the average until they added random delays.", source: "https://cloud.google.com/blog/products/gcp/how-to-avoid-a-self-inflicted-ddos-attack-cre-life-lessons" },
  ],
  "react-hook-form": [
    // React Hook Form official site: https://react-hook-form.com/
    { text: "React Hook Form depends on no other packages, so installing it adds nothing else to your project. As of 2026 its site reported more than 6 million npm downloads a month.", source: "https://react-hook-form.com/" },
  ],
  "react-props": [
    // The Morning Paper: To Type or Not to Type (Gao, Bird and Barr, ICSE 2017): https://blog.acolyer.org/2017/09/19/to-type-or-not-to-type-quantifying-detectable-bugs-in-javascript
    { text: "A 2017 study of 400 real JavaScript bugs found that 15% could have been caught before release by tools that check each value is the expected type. Passing the wrong kind of data into code is that sort of bug.", source: "https://blog.acolyer.org/2017/09/19/to-type-or-not-to-type-quantifying-detectable-bugs-in-javascript" },
  ],
  "react-state": [
    // InfoQ: Facebook: MVC Does Not Scale, Use Flux Instead: https://www.infoq.com/news/2014/05/facebook-mvc-flux/
    { text: "Facebook's chat used to tell people they had a new message when they did not, because parts of the page disagreed about the data. Facebook said Flux, a stricter way to manage state, got rid of the bug.", source: "https://www.infoq.com/news/2014/05/facebook-mvc-flux/" },
    // web.dev: How redBus improved INP and increased sales by 7%: https://web.dev/case-studies/redbus-inp
    { text: "Bus ticket site redBus found that each keystroke in its search box set off a costly state update that redrew the page. After fixing slow interactions like this, its sales rose 7%.", source: "https://web.dev/case-studies/redbus-inp" },
    // web.dev: Milliseconds make millions (Deloitte and 55 study for Google): https://web.dev/case-studies/milliseconds-make-millions
    { text: "A 2019 study of 37 brand websites and 30 million visits found that making a mobile site 0.1 seconds faster lifted the share of retail visitors who bought by 8.4%. A slow interface costs real money.", source: "https://web.dev/case-studies/milliseconds-make-millions" },
    // web.dev: Why does speed matter?: https://web.dev/articles/why-speed-matters
    { text: "The BBC found that it lost another 10% of its users for every extra second its site took to load. People leave an interface that feels slow.", source: "https://web.dev/articles/why-speed-matters" },
  ],
  "redis": [
    // OpenAI: March 20 ChatGPT outage: https://openai.com/index/march-20-chatgpt-outage/
    { text: "In March 2023, a bug in a Redis client library let some ChatGPT users see the titles of other people's chats. It also exposed payment details of 1.2% of ChatGPT Plus subscribers active in a nine-hour window.", source: "https://openai.com/index/march-20-chatgpt-outage/" },
    // Wikipedia: Redis: https://en.wikipedia.org/wiki/Redis
    { text: "In March 2024, Redis dropped its open source licence. The Linux Foundation answered by copying the last open version into a new project called Valkey, and in May 2025 Redis added an open source licence again.", source: "https://en.wikipedia.org/wiki/Redis" },
    // Trend Micro Research: https://www.trendmicro.com/en_us/research/20/d/exposed-redis-instances-abused-for-remote-code-execution-cryptocurrency-mining.html
    { text: "Trend Micro researchers found more than 8,000 Redis servers open to the internet with no password. In 2020 they reported attackers were turning such servers into bots that mined cryptocurrency.", source: "https://www.trendmicro.com/en_us/research/20/d/exposed-redis-instances-abused-for-remote-code-execution-cryptocurrency-mining.html" },
  ],
  "redux-toolkit": [
    // Redux docs: History of Redux: https://redux.js.org/understanding/history-and-design/history-of-redux
    { text: "Redux was written in 2015 by Dan Abramov as a demo for a conference talk. He wanted to show \"time travel\" debugging, where you step an app backwards and forwards through its past states.", source: "https://redux.js.org/understanding/history-and-design/history-of-redux" },
    // Redux docs: Why Redux Toolkit is How To Use Redux Today: https://redux.js.org/toolkit/introduction/why-rtk-is-redux-today
    { text: "The Redux maintainers now call the original redux package obsolete for new code. They built Redux Toolkit to cut the repeated setup code and to stop accidental data changes, the top cause of Redux bugs.", source: "https://redux.js.org/toolkit/introduction/why-rtk-is-redux-today" },
  ],
  "resend": [
    // Resend Handbook: How we got here: https://resend.com/handbook/company/how-we-got-here
    { text: "The team behind Resend first released a free tool for designing emails, called React Email, in December 2022. The paid email sending service was only announced a month later.", source: "https://resend.com/handbook/company/how-we-got-here" },
    // Resend Handbook: How we got here: https://resend.com/handbook/company/how-we-got-here
    { text: "Resend stayed behind a waitlist until June 2023. It still reached 100,000 users by April 2024, about 15 months after it started.", source: "https://resend.com/handbook/company/how-we-got-here" },
  ],
  "sentry": [
    // Sentry Blog: Happy Birthday, Sentry: https://blog.sentry.io/happy-birthday-sentry
    { text: "Sentry began in May 2008 as a small Django add-on called django-db-log. It was built because Django sent one email for every single error, which flooded inboxes on busy sites.", source: "https://blog.sentry.io/happy-birthday-sentry" },
  ],
  "shadcn-ui": [
    // shadcn/ui documentation: https://ui.shadcn.com/docs
    { text: "shadcn/ui is not a package you install and import. Its docs say \"This is not a component library\": it hands you the actual code for each button or dialog, and you own and edit that code.", source: "https://ui.shadcn.com/docs" },
  ],
  "skill-reading-errors": [
    // Wikipedia: Apollo Guidance Computer: https://en.wikipedia.org/wiki/Apollo_Guidance_Computer
    { text: "During the Apollo 11 moon landing in 1969, the computer flashed alarm codes 1202 and 1201. Mission control checked what the codes meant, called \"Go\", and the landing went ahead.", source: "https://en.wikipedia.org/wiki/Apollo_Guidance_Computer" },
    // Wikipedia: Therac-25: https://en.wikipedia.org/wiki/Therac-25
    { text: "The Therac-25 radiation machine showed operators only \"MALFUNCTION 54\" with no clear explanation. Operators pressed P to proceed, and patients received massive overdoses.", source: "https://en.wikipedia.org/wiki/Therac-25" },
    // U.S. Securities and Exchange Commission press release 2013-222: https://www.sec.gov/newsroom/press-releases/2013-222
    { text: "Before markets opened on August 1, 2012, Knight Capital's systems sent staff 97 emails about an error. Nobody acted on them, and the faulty software lost the firm more than $440 million in 45 minutes.", source: "https://www.sec.gov/newsroom/press-releases/2013-222" },
    // Barik et al., Do Developers Read Compiler Error Messages? (ICSE 2017): https://jssmith1.github.io/assets/pdf/ICSE_2017_EYE.pdf
    { text: "An eye-tracking study of 56 student programmers found they spent 13% to 25% of their task time reading error messages. Those who found the messages hard to read did worse at fixing the bugs.", source: "https://jssmith1.github.io/assets/pdf/ICSE_2017_EYE.pdf" },
    // Wikipedia: 2013 Target data breach: https://en.wikipedia.org/wiki/2013_Target_data_breach
    { text: "In 2013, Target's security tool reportedly warned staff about an attack in progress, but no one acted on it. Thieves took details of up to 40 million payment cards.", source: "https://en.wikipedia.org/wiki/2013_Target_data_breach" },
  ],
  "socket-io": [
    // Wikipedia: Guillermo Rauch: https://en.wikipedia.org/wiki/Guillermo_Rauch
    { text: "Socket.IO was created by Guillermo Rauch, who later founded Vercel and created Next.js.", source: "https://en.wikipedia.org/wiki/Guillermo_Rauch" },
    // Socket.IO Docs: Introduction: https://socket.io/docs/v4/
    { text: "Socket.IO's own docs state in capital letters that it is NOT a WebSocket implementation. If a WebSocket connection cannot be made, Socket.IO falls back to plain HTTP requests instead.", source: "https://socket.io/docs/v4/" },
  ],
  "sql-interpolation": [
    // Wikipedia: SQL injection: https://en.wikipedia.org/wiki/SQL_injection
    { text: "US prosecutors said Albert Gonzalez stole 130 million credit card numbers from Heartland Payment Systems, 7-Eleven and others using SQL injection. He was sentenced to 20 years in prison.", source: "https://en.wikipedia.org/wiki/SQL_injection" },
    // Wikipedia: 2015 TalkTalk data breach: https://en.wikipedia.org/wiki/2015_TalkTalk_data_breach
    { text: "In 2015 attackers, one of them aged 15, used SQL injection on three old TalkTalk web pages and reached 156,959 customer accounts. The UK telecom was fined £400,000 and put its total costs at about £77 million.", source: "https://en.wikipedia.org/wiki/2015_TalkTalk_data_breach" },
    // Wikipedia: 2023 MOVEit data breach: https://en.wikipedia.org/wiki/2023_MOVEit_data_breach
    { text: "In 2023 one SQL injection flaw in the MOVEit file transfer tool let attackers steal data from more than 2,700 organizations. About 93 million people had personal details exposed.", source: "https://en.wikipedia.org/wiki/2023_MOVEit_data_breach" },
  ],
  "sqlalchemy": [
    // SQLAlchemy blog: SQLAlchemy 2.0.0 Released: https://www.sqlalchemy.org/blog/2023/01/26/sqlalchemy-2.0.0-released/
    { text: "SQLAlchemy was first released on 14 February 2006. Its version 2.0 did not arrive until 26 January 2023, almost 17 years later.", source: "https://www.sqlalchemy.org/blog/2023/01/26/sqlalchemy-2.0.0-released/" },
  ],
  "storybook": [
    // Storybook Blog: The Storybook Story: https://storybook.js.org/blog/the-storybook-story
    { text: "The startup behind Storybook shut down in December 2016 and work on it stalled. After a GitHub thread asked if the project was dead, volunteers took it over and shipped Storybook 3.0 in May 2017.", source: "https://storybook.js.org/blog/the-storybook-story" },
  ],
  "stripe": [
    // Stripe Blog: Stripe's payments APIs, the first 10 years: https://stripe.dev/blog/payment-api-design
    { text: "Stripe's famous \"seven lines of code\" came from a magazine cover, not from Stripe. Stripe later wrote that nobody is sure which seven lines were meant, and that its own 2011 example was nine lines long.", source: "https://stripe.dev/blog/payment-api-design" },
    // Stripe Blog: APIs as infrastructure, future-proofing Stripe with versioning: https://stripe.com/blog/api-versioning
    { text: "Stripe names each version of its API after its release date, such as 2017-05-24. In 2017 it said it still supported every version since 2011, so old code kept working through almost 100 breaking changes.", source: "https://stripe.com/blog/api-versioning" },
  ],
  "supabase": [
    // Wiz Research: https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys
    { text: "In 2026, Wiz researchers found that Moltbook, a social site for AI agents, ran on Supabase with no row level security. Anyone could read 1.5 million secret API tokens and 35,000 email addresses.", source: "https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys" },
  ],
  "tailwind-css": [
    // Adam Wathan: Tailwind CSS, From Side-Project Byproduct to Multi-Million Dollar Business: https://adamwathan.me/tailwindcss-from-side-project-byproduct-to-multi-mullion-dollar-business/
    { text: "Tailwind CSS started as leftover styling code from a side project that its creator abandoned. Its first paid add-on, Tailwind UI, then made close to $2 million in about six months in 2020.", source: "https://adamwathan.me/tailwindcss-from-side-project-byproduct-to-multi-mullion-dollar-business/" },
    // DevClass: https://www.devclass.com/ai-ml/2026/01/08/tailwind-labs-lays-off-75-percent-of-its-engineers-thanks-to-brutal-impact-of-ai/4079571
    { text: "In January 2026, the company behind Tailwind CSS laid off 3 of its 4 engineers. Tailwind use was at a record high, but revenue had fallen almost 80% as AI tools sent fewer visitors to its docs.", source: "https://www.devclass.com/ai-ml/2026/01/08/tailwind-labs-lays-off-75-percent-of-its-engineers-thanks-to-brutal-impact-of-ai/4079571" },
    // Tailwind CSS blog: Tailwind Labs is joining Shopify: https://tailwindcss.com/blog/tailwind-is-joining-shopify
    { text: "By September 2026, Tailwind CSS was being installed more than 110 million times a week. That month its small team joined Shopify, and the framework stayed free and open source.", source: "https://tailwindcss.com/blog/tailwind-is-joining-shopify" },
  ],
  "tests": [
    // Wikipedia: 2024 CrowdStrike-related IT outages: https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages
    { text: "On 19 July 2024 a faulty CrowdStrike update crashed about 8.5 million Windows computers, and over 5,000 flights were cancelled. CrowdStrike's review said its testing had not covered all cases.", source: "https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages" },
    // Wikipedia: Boeing Orbital Flight Test: https://en.wikipedia.org/wiki/Boeing_Orbital_Flight_Test
    { text: "In December 2019 Boeing's Starliner capsule flew with its mission clock 11 hours off and never reached the space station. NASA's review said the software had been tested in chunks, not end to end.", source: "https://en.wikipedia.org/wiki/Boeing_Orbital_Flight_Test" },
    // GitHub Blog: https://github.blog/news-insights/today-s-outage/
    { text: "In November 2010 a settings mistake made GitHub's automated tests run against the live site instead of the test setup. The tests destroyed the production database, which had to be restored from a backup.", source: "https://github.blog/news-insights/today-s-outage/" },
  ],
  "trpc": [
    // Syntax podcast, episode 526 transcript: https://beta.syntax.fm/show/526/supper-club-trpc-with-alex-katt-johansson/transcript
    { text: "tRPC began as a small proof of concept by Colin McDonnell, the creator of Zod. Alex Johansson found it abandoned on GitHub and took it over, and he still leads the project.", source: "https://beta.syntax.fm/show/526/supper-club-trpc-with-alex-katt-johansson/transcript" },
  ],
  "twilio": [
    // Twilio blog: Incident report on employee and customer account compromise: https://www.twilio.com/en-us/blog/august-2022-social-engineering-attack
    { text: "In 2022, attackers texted Twilio employees fake login links while posing as the IT team. Some staff typed in their passwords, and data belonging to 209 Twilio customers was accessed.", source: "https://www.twilio.com/en-us/blog/august-2022-social-engineering-attack" },
    // TechCrunch: https://techcrunch.com/2024/07/03/twilio-says-hackers-identified-cell-phone-numbers-of-two-factor-app-authy-users/
    { text: "In 2024, a hacking group claimed it had collected the phone numbers of 33 million users of Twilio's Authy app. Twilio said the cause was an endpoint that did not ask for a login.", source: "https://techcrunch.com/2024/07/03/twilio-says-hackers-identified-cell-phone-numbers-of-two-factor-app-authy-users/" },
  ],
  "type-escape": [
    // Wikipedia: Ariane flight V88: https://en.wikipedia.org/wiki/Ariane_flight_V88
    { text: "In 1996 the first Ariane 5 rocket veered off course 37 seconds after launch and was lost. Its software had tried to fit a 64-bit number into a 16-bit integer, and the failure cost over $370 million.", source: "https://en.wikipedia.org/wiki/Ariane_flight_V88" },
    // Wikipedia: Mars Climate Orbiter: https://en.wikipedia.org/wiki/Mars_Climate_Orbiter
    { text: "In 1999 NASA lost the Mars Climate Orbiter because one program reported thrust in pound-force seconds and another expected newton-seconds. The mission had cost $327.6 million.", source: "https://en.wikipedia.org/wiki/Mars_Climate_Orbiter" },
    // Engadget: https://www.engadget.com/2015-05-01-boeing-787-dreamliner-software-bug.html
    { text: "In 2015 US regulators warned that a Boeing 787 left powered on for 248 days could lose all AC electrical power, because a counter in its software would overflow. Planes had to be switched off and on.", source: "https://www.engadget.com/2015-05-01-boeing-787-dreamliner-software-bug.html" },
    // BleepingComputer: https://www.bleepingcomputer.com/news/microsoft/microsoft-exchange-year-2022-bug-in-fip-fs-breaks-email-delivery/
    { text: "On 1 January 2022 Microsoft Exchange servers stopped delivering email. The new date was stored as the number 2,201,010,001, too big for a type that tops out at 2,147,483,647.", source: "https://www.bleepingcomputer.com/news/microsoft/microsoft-exchange-year-2022-bug-in-fip-fs-breaks-email-delivery/" },
  ],
  "uploadthing": [
    // UploadThing official site: https://uploadthing.com/
    { text: "UploadThing is made by Ping Labs, the company of YouTuber Theo. He said he had asked for a better version of Amazon's S3 file storage for years and built UploadThing because he got tired of waiting.", source: "https://uploadthing.com/" },
  ],
  "vercel": [
    // InfoQ: Cara's Vercel bill: https://www.infoq.com/news/2024/06/vercel-serverless-scale-expenses
    { text: "In June 2024 the artist app Cara grew from 40,000 to 650,000 users in a week. Its founder then received a $98,280 bill from Vercel for the functions that traffic had used.", source: "https://www.infoq.com/news/2024/06/vercel-serverless-scale-expenses" },
  ],
  "webhook": [
    // Tenable: CVE-2026-9832: https://www.tenable.com/cve/CVE-2026-9832
    { text: "In 2026 a Stripe payment plugin for WooCommerce was found to skip the webhook signature check on fresh installs. Anyone could send a fake Stripe message and mark an unpaid order as paid.", source: "https://www.tenable.com/cve/CVE-2026-9832" },
    // Rapid7: CVE-2026-33731: https://www.rapid7.com/db/vulnerabilities/cve-2026-33731/
    { text: "A 2026 flaw in the AVideo video platform let attackers forge payment webhooks. After one small real purchase, they could credit any amount to any user's wallet or switch on paid subscriptions for free.", source: "https://www.rapid7.com/db/vulnerabilities/cve-2026-33731/" },
    // GitHub Advisory Database: https://github.com/advisories/GHSA-9mp4-77wg-rwx9
    { text: "In 2025 the login service Clerk disclosed that its webhook helper did not check signatures correctly, so apps could accept fake events as real. Fixes had to ship in nine separate packages.", source: "https://github.com/advisories/GHSA-9mp4-77wg-rwx9" },
  ],
  "xss-html-injection": [
    // Wikipedia: Samy (computer worm): https://en.wikipedia.org/wiki/Samy_(computer_worm)
    { text: "In 2005 Samy Kamkar put a script in his MySpace profile that copied itself to everyone who viewed it. Within 20 hours more than one million users had run it, and he got three years of probation.", source: "https://en.wikipedia.org/wiki/Samy_(computer_worm)" },
    // Wikipedia: TweetDeck: https://en.wikipedia.org/wiki/TweetDeck
    { text: "In June 2014 a cross-site scripting hole in TweetDeck let a single tweet repost itself from the account of anyone who saw it. It affected more than 83,000 Twitter users.", source: "https://en.wikipedia.org/wiki/TweetDeck" },
    // Apache Infrastructure Team incident report: https://infra.apache.org/blog/apache_org_04_09_2010
    { text: "In 2010 attackers sent Apache's server admins a link that used cross-site scripting to steal their login cookies. From there they gained full control of a server for several hours and copied password databases.", source: "https://infra.apache.org/blog/apache_org_04_09_2010" },
    // Graham Cluley: https://grahamcluley.com/twitter-onmouseover-security-flaw-widely-exploited/
    { text: "In 2010 a Twitter flaw let tweets carry script that ran when a reader merely moved the mouse over them. Thousands of accounts were hit, and one with over a million followers sent visitors to a porn site.", source: "https://grahamcluley.com/twitter-onmouseover-security-flaw-widely-exploited/" },
  ],
  "zod": [
    // Zod: Release notes for Zod 4: https://zod.dev/v4
    { text: "Zod went from about 600,000 npm downloads a week in May 2021 to 31 million a week around the launch of Zod 4, according to its own release notes.", source: "https://zod.dev/v4" },
  ],
  "zustand": [
    // GitHub: pmndrs/jotai documentation: https://github.com/pmndrs/jotai/blob/v1.9.1/docs/basics/comparison.mdx
    { text: "Zustand is simply the German word for \"state\". Its sister library Jotai got the same treatment: jotai means \"state\" in Japanese.", source: "https://github.com/pmndrs/jotai/blob/v1.9.1/docs/basics/comparison.mdx" },
  ],
};

/** For cards with no fact of their own: software going wrong, or right, in ways worth remembering. */
export const GENERAL_FACTS: readonly Fact[] = [
  // Wikipedia: Mariner 1: https://en.wikipedia.org/wiki/Mariner_1
  { text: "In 1962, NASA's Mariner 1 rocket was destroyed less than 5 minutes after launch because one symbol was missing from its guidance program. The mission had cost $18.5 million.", source: "https://en.wikipedia.org/wiki/Mariner_1" },
  // Wikipedia: Mars Climate Orbiter: https://en.wikipedia.org/wiki/Mars_Climate_Orbiter
  { text: "NASA lost its Mars Climate Orbiter in 1999 because one team's software reported force in pounds and another's expected metric units. The numbers were off by a factor of 4.45 and the craft flew too close to Mars.", source: "https://en.wikipedia.org/wiki/Mars_Climate_Orbiter" },
  // Wikipedia: Therac-25: https://en.wikipedia.org/wiki/Therac-25
  { text: "Between 1985 and 1987, the Therac-25 radiation therapy machine gave at least six patients massive overdoses because of software bugs. Three of them died from the overdose.", source: "https://en.wikipedia.org/wiki/Therac-25" },
  // Wikipedia: Knight Capital Group: https://en.wikipedia.org/wiki/Knight_Capital_Group
  { text: "In 2012, trading firm Knight Capital put new code on only seven of its eight servers. The eighth ran old code that sent millions of unwanted orders, and the firm lost more than $440 million in 45 minutes.", source: "https://en.wikipedia.org/wiki/Knight_Capital_Group" },
  // Wikipedia: Ariane flight V88: https://en.wikipedia.org/wiki/Ariane_flight_V88
  { text: "In 1996, the Ariane 5 rocket failed 37 seconds after launch because a number was too big for the 16-bit slot its software put it in. The code was reused from an older rocket, and the loss topped $370 million.", source: "https://en.wikipedia.org/wiki/Ariane_flight_V88" },
  // Wikipedia: MIM-104 Patriot: https://en.wikipedia.org/wiki/MIM-104_Patriot
  { text: "In 1991, a Patriot missile defense system had been running for 100 hours and its clock had drifted by a third of a second. It failed to stop an incoming missile that killed 28 soldiers.", source: "https://en.wikipedia.org/wiki/MIM-104_Patriot" },
  // Wikipedia: British Post Office scandal: https://en.wikipedia.org/wiki/British_Post_Office_scandal
  { text: "From 1999 to 2015, more than 900 UK post office managers were prosecuted after the Horizon accounting software wrongly showed money missing from their branches. Of those, 236 were sent to prison.", source: "https://en.wikipedia.org/wiki/British_Post_Office_scandal" },
  // Wikipedia: Morris worm: https://en.wikipedia.org/wiki/Morris_worm
  { text: "In 1988, a student's program copied itself far more often than he intended and clogged an estimated 6,000 computers, about a tenth of the internet then. His was the first felony conviction under the US computer fraud law.", source: "https://en.wikipedia.org/wiki/Morris_worm" },
  // GitLab: Postmortem of database outage of January 31: https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/
  { text: "In 2017, a GitLab engineer wiped the wrong database and deleted about 300 GB of live data. The daily backups had been failing unnoticed, so about 5,000 projects were lost and the site was down for 18 hours.", source: "https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/" },
  // Amazon Web Services: Summary of the Amazon S3 Service Disruption: https://aws.amazon.com/message/41926/
  { text: "In 2017, an Amazon engineer entered one input to a command wrongly and removed far more servers than intended. The S3 storage service, which many sites rely on, was disrupted for more than four hours.", source: "https://aws.amazon.com/message/41926/" },
  // Cloudflare Blog: Details of the Cloudflare outage on July 2, 2019: https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/
  { text: "In 2019, one badly written text-matching pattern (a regular expression) used up all the processing power on Cloudflare's servers. Websites that relied on Cloudflare went down for 27 minutes.", source: "https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/" },
  // Wikipedia: 2021 Facebook outage: https://en.wikipedia.org/wiki/2021_Facebook_outage
  { text: "In 2021, one maintenance command cut Facebook's data centers off from the internet for about six hours. Staff reportedly could not get into buildings because their security badges stopped working too.", source: "https://en.wikipedia.org/wiki/2021_Facebook_outage" },
  // Wikipedia: 2024 CrowdStrike-related IT outages: https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages
  { text: "In July 2024, one faulty update from security firm CrowdStrike crashed about 8.5 million Windows computers. More than 5,000 flights were cancelled that day.", source: "https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages" },
  // Wikipedia: npm left-pad incident: https://en.wikipedia.org/wiki/Npm_left-pad_incident
  { text: "In 2016, a developer removed his 11-line package called left-pad from the npm registry. Projects that relied on it, including React and Babel, could not be built or installed for about two hours.", source: "https://en.wikipedia.org/wiki/Npm_left-pad_incident" },
  // Wikipedia: Heartbleed: https://en.wikipedia.org/wiki/Heartbleed
  { text: "The Heartbleed bug sat in widely used security software for about two years before it was made public in 2014. Around half a million secure web servers, about 17%, were open to having private data read.", source: "https://en.wikipedia.org/wiki/Heartbleed" },
  // Wikipedia: 2017 Equifax data breach: https://en.wikipedia.org/wiki/2017_Equifax_data_breach
  { text: "In 2017, attackers stole data on about 147.9 million Americans from credit agency Equifax through a known software flaw. A fix had been released about two months earlier but had not been installed.", source: "https://en.wikipedia.org/wiki/2017_Equifax_data_breach" },
  // Wikipedia: Toy Story 2: https://en.wikipedia.org/wiki/Toy_Story_2
  { text: "In 1998, one accidental delete command erased about 90% of Pixar's work on Toy Story 2, and the backups had not worked for a month. The film was saved by a copy on an employee's home computer.", source: "https://en.wikipedia.org/wiki/Toy_Story_2" },
  // Wikipedia: Zune 30: https://en.wikipedia.org/wiki/Zune_30
  { text: "On December 31, 2008, Microsoft's Zune 30 music players froze because their clock code got stuck in a loop on day 366 of a leap year. The official fix was to let the battery run out and wait until the next day.", source: "https://en.wikipedia.org/wiki/Zune_30" },
  // Wikipedia: HealthCare.gov: https://en.wikipedia.org/wiki/HealthCare.gov
  { text: "Before the US site HealthCare.gov launched in 2013, tests showed it slowing down with just 1,100 users at once. About 250,000 arrived, and by some estimates only 1% of them managed to enroll in the first week.", source: "https://en.wikipedia.org/wiki/HealthCare.gov" },
  // Wikipedia: Boeing 737 MAX groundings: https://en.wikipedia.org/wiki/Boeing_737_MAX_groundings
  { text: "Software on Boeing's 737 MAX could push the plane's nose down based on one faulty sensor. Two crashes killed 346 people, and US regulators grounded the plane for 20 months.", source: "https://en.wikipedia.org/wiki/Boeing_737_MAX_groundings" },
  // Wikipedia: Stuxnet: https://en.wikipedia.org/wiki/Stuxnet
  { text: "The Stuxnet worm, found in 2010, changed the speed of Iran's nuclear centrifuges while showing operators normal readings. It is estimated to have destroyed up to 1,000 of the machines.", source: "https://en.wikipedia.org/wiki/Stuxnet" },
  // Wikipedia: Pentium FDIV bug: https://en.wikipedia.org/wiki/Pentium_FDIV_bug
  { text: "In 1994, a maths professor found that Intel's Pentium chip gave slightly wrong answers to some divisions. Replacing the flawed chips cost Intel $475 million.", source: "https://en.wikipedia.org/wiki/Pentium_FDIV_bug" },
  // Wikipedia: 2018 Hawaii false missile alert: https://en.wikipedia.org/wiki/2018_Hawaii_false_missile_alert
  { text: "In 2018, a worker in Hawaii chose the real \"missile alert\" option instead of the test one. Phones across the state warned of an incoming missile, and the correction took 38 minutes to arrive.", source: "https://en.wikipedia.org/wiki/2018_Hawaii_false_missile_alert" },
  // Wikipedia: Log4Shell: https://en.wikipedia.org/wiki/Log4Shell
  { text: "A security hole in Log4j, a logging tool built into a huge number of apps, went unnoticed from 2013 until 2021. One study found it affected 93% of business cloud setups.", source: "https://en.wikipedia.org/wiki/Log4Shell" },
  // Wikipedia: Leap second: https://en.wikipedia.org/wiki/Leap_second
  { text: "When one extra second was added to the world's clocks on June 30, 2012, software at Reddit, Mozilla and Qantas ran into problems. Even a single unexpected second can break a program.", source: "https://en.wikipedia.org/wiki/Leap_second" },
  // The Register: https://www.theregister.com/2020/10/05/excel_england_coronavirus_contact_error/
  { text: "In 2020, England left 15,841 Covid cases out of its daily counts because results were stored in an old Excel format that holds only 65,536 rows. Anything past the limit was dropped without warning.", source: "https://www.theregister.com/2020/10/05/excel_england_coronavirus_contact_error/" },
  // Wikipedia: Citibank: https://en.wikipedia.org/wiki/Citibank
  { text: "In 2020, Citibank meant to send about $7.8 million in interest for Revlon and wired about $900 million of its own money by mistake. Some lenders kept roughly $500 million, and it took a court fight to settle.", source: "https://en.wikipedia.org/wiki/Citibank" },
  // Bruce Sterling, The Hacker Crackdown, Part 1 (MIT-hosted copy): https://web.mit.edu/hacker/part1.html
  { text: "On January 15, 1990, one misplaced \"break\" in a software update spread a fault across AT&T's long-distance network in the US. About 70 million calls failed during the nine hours it took to fix.", source: "https://web.mit.edu/hacker/part1.html" },
  // Wikipedia: 2009-2011 Toyota vehicle recalls: https://en.wikipedia.org/wiki/2009%E2%80%932011_Toyota_vehicle_recalls
  { text: "Toyota recalled about 9 million vehicles over sudden acceleration. In a 2013 trial, a software expert said one flipped bit in the car's computer could cause it, and the jury ruled against Toyota.", source: "https://en.wikipedia.org/wiki/2009%E2%80%932011_Toyota_vehicle_recalls" },
];
