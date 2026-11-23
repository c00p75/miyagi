/**
 * "Did you know": true facts shown while a card's hook is being written for
 * the learner's project. The panel shows one the learner has not seen yet.
 *
 * Every fact was researched against the source beside it, then checked again
 * by a separate fact-checker who confirmed or corrected each detail; nothing
 * either could not confirm is here (docs/TEACHING.md). The bar: a real event
 * with a consequence and, where possible, a number; directly about the idea
 * or tool it is filed under; at most two or three short sentences in plain
 * words. A model never writes these at run time.
 *
 * To add one, find a source you have read, and add the fact with its link.
 * `test/lesson.test.ts` holds every entry to the rules.
 */

export interface Fact {
  text: string;
  /** Where it was checked. Not shown to the learner; kept so the fact can be checked again. */
  source: string;
}

/** By idea id or tool id. */
export const FACTS: Readonly<Record<string, readonly Fact[]>> = {
  "anthropic-sdk": [
    // Source: https://github.blog/changelog/2024-08-20-anthropic-is-now-a-github-secret-scanning-partner/
    { text: "Since August 2024 GitHub has scanned public repositories for Anthropic API keys and sent any it finds to Anthropic. Anthropic then switches off the leaked key and tells its owner.", source: "https://github.blog/changelog/2024-08-20-anthropic-is-now-a-github-secret-scanning-partner/" },
    // Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    { text: "The Anthropic API can remember the start of a long prompt for 5 minutes. As of 2026, reading that saved part again costs a tenth or less of the normal input price.", source: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching" },
  ],
  "api-route": [
    // Source: https://www.itnews.com.au/news/optus-breach-allegedly-enabled-by-access-control-coding-error-608985
    { text: "In September 2022 data on up to 10 million Optus customers, about a third of Australia's population, was exposed. Optus later said the attacker used a weakness left by an old coding error.", source: "https://www.itnews.com.au/news/optus-breach-allegedly-enabled-by-access-control-coding-error-608985" },
    // Source: https://krebsonsecurity.com/2018/11/usps-site-exposed-data-on-60-million-users/
    { text: "Until November 2018 a US Postal Service API let any logged-in user look up account details of some 60 million other users. A researcher said he had reported it more than a year earlier.", source: "https://krebsonsecurity.com/2018/11/usps-site-exposed-data-on-60-million-users/" },
    // Source: https://techcrunch.com/2021/05/05/peloton-bug-account-data-leak/
    { text: "In 2021 a researcher found that Peloton's API handed out private account data, such as age, weight and city, without checking who was asking. Peloton had more than 3 million subscribers.", source: "https://techcrunch.com/2021/05/05/peloton-bug-account-data-leak/" },
    // Source: https://sec.gov/Archives/edgar/data/1283699/000119312523010949/d641142d8k.htm
    { text: "From 25 November 2022 an attacker pulled data on 37 million T-Mobile customers through a single API. T-Mobile did not notice until 5 January 2023.", source: "https://sec.gov/Archives/edgar/data/1283699/000119312523010949/d641142d8k.htm" },
    // Source: https://samcurry.net/hacking-kia
    { text: "In 2024 researchers found that Kia's dealer website let anyone sign up and reach dealer-only APIs. With just a license plate they could locate, unlock and start almost any Kia made after 2013 in about 30 seconds.", source: "https://samcurry.net/hacking-kia" },
    // Source: https://krebsonsecurity.com/2021/04/experian-api-exposed-credit-scores-of-most-americans/
    { text: "In 2021 a college student found an Experian API that returned the credit scores of tens of millions of Americans with no login. It needed only a name and address, and accepted all zeros as the date of birth.", source: "https://krebsonsecurity.com/2021/04/experian-api-exposed-credit-scores-of-most-americans/" },
    // Source: https://krebsonsecurity.com/2018/04/panerabread-com-leaks-millions-of-customer-records/
    { text: "In August 2017 a researcher told Panera Bread its website showed customer records to anyone. It was still open eight months later, and KrebsOnSecurity put the total above 37 million, though Panera said 10,000.", source: "https://krebsonsecurity.com/2018/04/panerabread-com-leaks-millions-of-customer-records/" },
    // Source: https://www.bleepingcomputer.com/news/security/twitter-confirms-zero-day-used-to-expose-data-of-54-million-accounts/
    { text: "A Twitter code change in June 2021 let anyone submit an email or phone number and learn which account it belonged to. Before the fix in January 2022, someone built a list said to cover 5.4 million accounts and asked $30,000.", source: "https://www.bleepingcomputer.com/news/security/twitter-confirms-zero-day-used-to-expose-data-of-54-million-accounts/" },
  ],
  "async-await": [
    // Source: https://en.wikipedia.org/wiki/Therac-25
    { text: "Between 1985 and 1987 the Therac-25 radiation machine gave at least six patients massive overdoses. Race conditions in its software meant quick typing by the operator could trigger a deadly beam.", source: "https://en.wikipedia.org/wiki/Therac-25" },
    // Source: https://en.wikipedia.org/wiki/Northeast_blackout_of_2003
    { text: "In the 2003 Northeast blackout, a race condition froze a power company's alarm system for over an hour, so operators did not see the grid failing. About 55 million people lost power.", source: "https://en.wikipedia.org/wiki/Northeast_blackout_of_2003" },
    // Source: https://aws.amazon.com/message/101925/
    { text: "In October 2025 two automated AWS processes updated the same DNS record in the wrong order and left it empty. This race condition disrupted services in AWS's Northern Virginia region for over 14 hours.", source: "https://aws.amazon.com/message/101925/" },
    // Source: https://github.blog/2021-03-18-how-we-found-and-fixed-a-rare-race-condition-in-our-session-handling/
    { text: "In March 2021 a rare race condition on GitHub handed a few users someone else's login session. To be safe, GitHub logged out every user on the site.", source: "https://github.blog/2021-03-18-how-we-found-and-fixed-a-rare-race-condition-in-our-session-handling/" },
    // Source: https://en.wikipedia.org/wiki/Mars_Pathfinder
    { text: "In July 1997 NASA's Mars Pathfinder lander reset its computer four times because one task was blocking a more urgent one. The bug had shown up in testing before launch but was written off as a glitch.", source: "https://en.wikipedia.org/wiki/Mars_Pathfinder" },
    // Source: https://en.wikipedia.org/wiki/Dirty_COW
    { text: "A race condition known as Dirty COW sat in the Linux kernel from 2007 until it was patched in October 2016. It let an ordinary user take full control of a machine, and it worked on older Android phones too.", source: "https://en.wikipedia.org/wiki/Dirty_COW" },
    // Source: https://en.wikipedia.org/wiki/STS-1
    { text: "The first Space Shuttle launch attempt, on 10 April 1981, was called off 18 minutes before liftoff because the main computers and the backup computer were out of step on timing. Columbia flew two days later.", source: "https://en.wikipedia.org/wiki/STS-1" },
    // Source: https://en.wikipedia.org/wiki/Concurrent_testing
    { text: "A 2008 study looked at 105 real bugs caused by code running at the same time in MySQL, Apache, Mozilla and OpenOffice. In 31 of them, pieces of code were stuck waiting on each other, which is called a deadlock.", source: "https://en.wikipedia.org/wiki/Concurrent_testing" },
  ],
  "auth-token": [
    // Source: https://en.wikipedia.org/wiki/Firesheep
    { text: "In 2010 a free Firefox add-on called Firesheep let anyone on a shared Wi-Fi network take over other people's Facebook and Twitter sessions with a click. It worked by reading login cookies sent without encryption.", source: "https://en.wikipedia.org/wiki/Firesheep" },
    // Source: https://github.blog/news-insights/company-news/security-alert-stolen-oauth-user-tokens/
    { text: "In April 2022 GitHub said an attacker used access tokens stolen from two connected services, Heroku and Travis CI, to download private code from dozens of organizations. One of them was npm.", source: "https://github.blog/news-insights/company-news/security-alert-stolen-oauth-user-tokens/" },
    // Source: https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift
    { text: "In August 2025 attackers stole access tokens from the Salesloft Drift chat app and spent about ten days using them to export data from many companies' Salesforce accounts. Every active Drift token had to be cancelled.", source: "https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift" },
    // Source: https://blog.cloudflare.com/thanksgiving-2023-security-incident/
    { text: "After the 2023 Okta breach, Cloudflare replaced its leaked logins but missed one token and three accounts it believed were unused. An attacker used them weeks later, and Cloudflare then replaced over 5,000 credentials.", source: "https://blog.cloudflare.com/thanksgiving-2023-security-incident/" },
    // Source: https://blog.google/threat-analysis-group/phishing-campaign-targets-youtube-creators-cookie-theft-malware/
    { text: "Google said in 2021 that it had restored about 4,000 YouTube accounts hijacked with stolen login cookies. Fake sponsorship offers got creators to run malware, and the stolen channels sold for $3 to $4,000 each.", source: "https://blog.google/threat-analysis-group/phishing-campaign-targets-youtube-creators-cookie-theft-malware/" },
    // Source: https://about.fb.com/news/2018/10/update-on-security-issue/
    { text: "In 2018 attackers stole the access tokens of about 30 million Facebook accounts. A token keeps a person logged in, so holding one meant getting into the account without ever knowing the password.", source: "https://about.fb.com/news/2018/10/update-on-security-issue/" },
    // Source: https://sec.okta.com/articles/2023/11/unauthorized-access-oktas-support-case-management-system-root-cause/
    { text: "In 2023 an intruder got into Okta's support system and opened files from 134 customers. Some files held session tokens, which were then used to hijack the live Okta sessions of 5 customers.", source: "https://sec.okta.com/articles/2023/11/unauthorized-access-oktas-support-case-management-system-root-cause/" },
    // Source: https://circleci.com/blog/jan-4-2023-incident-report/
    { text: "In December 2022 malware on a CircleCI engineer's laptop stole a login session that had already passed two-factor checks. The attacker used it to pose as the engineer and reach production systems.", source: "https://circleci.com/blog/jan-4-2023-incident-report/" },
    // Source: https://www.techradar.com/news/ea-hack-reportedly-used-stolen-cookies-and-slack-to-hack-gaming-giant
    { text: "In 2021 hackers told reporters they bought a stolen login cookie for $10 and used it to get into Electronic Arts' Slack. They said they left with 780GB of data, including the source code for FIFA 21.", source: "https://www.techradar.com/news/ea-hack-reportedly-used-stolen-cookies-and-slack-to-hack-gaming-giant" },
    // Source: https://www.microsoft.com/en-us/security/blog/2023/07/14/analysis-of-storm-0558-techniques-for-unauthorized-email-access/
    { text: "In 2023 attackers who had obtained a Microsoft signing key forged their own login tokens. Microsoft said they used them to read email at about 25 organizations, including government agencies.", source: "https://www.microsoft.com/en-us/security/blog/2023/07/14/analysis-of-storm-0558-techniques-for-unauthorized-email-access/" },
  ],
  "authjs": [
    // Source: https://github.com/advisories/GHSA-xv97-c62v-4587
    { text: "In August 2022 a flaw rated 9.1 out of 10 was fixed in NextAuth.js, now called Auth.js. A sign-in request with two email addresses joined by a comma sent the login link to both, attacker and victim.", source: "https://github.com/advisories/GHSA-xv97-c62v-4587" },
    // Source: https://better-auth.com/blog/authjs-joins-better-auth
    { text: "In September 2025 the team behind a newer rival, Better Auth, took over maintaining Auth.js. They said they would keep fixing security problems but suggested most new projects start with Better Auth.", source: "https://better-auth.com/blog/authjs-joins-better-auth" },
  ],
  "background-job": [
    // Source: https://www.fca.org.uk/news/press-releases/fca-fines-rbs-natwest-and-ulster-bank-ltd-%C2%A342-million-it-failures
    { text: "In June 2012 a failed upgrade to the software that updated accounts overnight at RBS, NatWest and Ulster Bank disrupted over 6.5 million customers for weeks. Regulators fined the banks £56 million.", source: "https://www.fca.org.uk/news/press-releases/fca-fines-rbs-natwest-and-ulster-bank-ltd-%C2%A342-million-it-failures" },
    // Source: https://www.cbsnews.com/news/santander-bank-seeks-to-recover-175-million-christmas-mistake
    { text: "On Christmas Day 2021 a scheduling problem made Santander UK send 75,000 payments twice. The bank paid out £130 million of its own money by mistake and had to try to get it back.", source: "https://www.cbsnews.com/news/santander-bank-seeks-to-recover-175-million-christmas-mistake" },
    // Source: https://github.blog/2018-10-30-oct21-post-incident-analysis/
    { text: "In October 2018 a 43-second network break at GitHub led to 24 hours of degraded service. Background work piled up, with over 5 million webhook events and 80,000 site builds waiting in queues.", source: "https://github.blog/2018-10-30-oct21-post-incident-analysis/" },
    // Source: https://www.theregister.com/2024/02/29/fuel_pump_leap_year_bug/
    { text: "On 29 February 2024 self-service fuel pumps across New Zealand stopped taking card payments for more than ten hours. The payment software had a leap day bug.", source: "https://www.theregister.com/2024/02/29/fuel_pump_leap_year_bug/" },
    // Source: https://www.macrumors.com/2010/11/01/ios-4-1-daylight-saving-time-bug-strikes-europe/
    { text: "In autumn 2010 a daylight saving bug in iPhone software made repeating alarms ring an hour late across Europe after the clocks changed. In Australia and New Zealand they had rung an hour early.", source: "https://www.macrumors.com/2010/11/01/ios-4-1-daylight-saving-time-bug-strikes-europe/" },
    // Source: https://www.twilio.com/en-us/blog/company/communications/billing-incident-post-mortem-breakdown-analysis-and-root-cause-html
    { text: "On 18 July 2013 Twilio's billing system lost track of account balances. Its automatic top-up saw the accounts as empty and charged the cards of about 1.4% of customers again and again.", source: "https://www.twilio.com/en-us/blog/company/communications/billing-incident-post-mortem-breakdown-analysis-and-root-cause-html" },
    // Source: https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/
    { text: "When a leap second was added at midnight on 1 January 2017, the clock on Cloudflare's servers stepped backward and a time calculation came out negative. Some DNS lookups failed for over six hours.", source: "https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/" },
  ],
  "browser-storage": [
    // Source: https://techradar.com/news/ea-hack-reportedly-used-stolen-cookies-and-slack-to-hack-gaming-giant
    { text: "In 2021, hackers said they got into game maker EA starting with a stolen login cookie bought online for $10. They claimed to have taken 780 GB of data, including the source code of FIFA 21.", source: "https://techradar.com/news/ea-hack-reportedly-used-stolen-cookies-and-slack-to-hack-gaming-giant" },
    // Source: https://www.dexerto.com/entertainment/linus-tech-tips-explains-how-youtube-channel-got-hacked-for-crypto-scam-streams-2095412/
    { text: "In March 2023, a fake sponsorship file sent to Linus Tech Tips copied the login cookies saved in an employee's browser. Attackers used them to take over its YouTube channels and run crypto scam streams.", source: "https://www.dexerto.com/entertainment/linus-tech-tips-explains-how-youtube-channel-got-hacked-for-crypto-scam-streams-2095412/" },
    // Source: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
    { text: "Since 2020, Safari has deleted everything a site saved with scripts, including localStorage, once the user goes seven days of browser use without interacting with that site. Data kept only in the browser can vanish.", source: "https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/" },
    // Source: https://developer.chrome.com/blog/cookie-max-age-expires
    { text: "Since Chrome 104 in August 2022, no cookie can last longer than 400 days. A site that asks for a longer life gets it cut down to 400 days.", source: "https://developer.chrome.com/blog/cookie-max-age-expires" },
    // Source: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
    { text: "Browsers let a site keep only about 5 MiB in localStorage, and a write past that limit throws an error. When a device runs low on disk space, the browser can delete all the data of the sites used least recently.", source: "https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria" },
    // Source: https://en.wikipedia.org/wiki/Genesis_Market
    { text: "In April 2023 the FBI shut down Genesis Market, which sold logins stolen from 1.5 million infected computers. The takedown was named Operation Cookie Monster, and 119 people were arrested.", source: "https://en.wikipedia.org/wiki/Genesis_Market" },
  ],
  "bullmq": [
    // Source: https://docs.bullmq.io/guide/going-to-production
    { text: "BullMQ keeps its jobs in Redis, which can be set to delete data when memory runs low. BullMQ's docs say queues cannot work properly then, and that the noeviction setting is the only safe one.", source: "https://docs.bullmq.io/guide/going-to-production" },
  ],
  "caching": [
    // Source: https://store.steampowered.com/news/19852/
    { text: "On Christmas Day 2015 a caching mistake at Steam showed pages meant for one user to other users for about 90 minutes. Around 34,000 users may have had details such as billing addresses seen by strangers.", source: "https://store.steampowered.com/news/19852/" },
    // Source: https://openai.com/blog/march-20-chatgpt-outage
    { text: "On 20 March 2023 a bug in the library ChatGPT used to reach its cache showed some users the titles of other people's chats. Payment details of 1.2% of ChatGPT Plus subscribers may also have been exposed.", source: "https://openai.com/blog/march-20-chatgpt-outage" },
    // Source: https://slack.engineering/slacks-incident-on-2-22-22/
    { text: "On 22 February 2022 a rollout at Slack replaced too many cache servers with empty ones. With little left in the cache, requests flooded the database and many users could not open Slack.", source: "https://slack.engineering/slacks-incident-on-2-22-22/" },
    // Source: https://engineering.fb.com/2010/09/23/uncategorized/more-details-on-today-s-outage/
    { text: "On 23 September 2010 Facebook was down for about 2.5 hours. Every server saw a bad value in its cache and asked the database for a fix at once, and the flood of queries stopped the database from recovering.", source: "https://engineering.fb.com/2010/09/23/uncategorized/more-details-on-today-s-outage/" },
    // Source: https://en.wikipedia.org/wiki/Dan_Kaminsky
    { text: "In 2008 Dan Kaminsky found a way to plant false addresses in the caches of the internet's name servers, which could send people to fake websites. Vendors worked in secret and released a joint fix on 8 July 2008.", source: "https://en.wikipedia.org/wiki/Dan_Kaminsky" },
    // Source: https://omergil.blogspot.com/2017/02/web-cache-deception-attack.html
    { text: "In 2017 a researcher showed he could trick PayPal's cache into saving a logged-in user's private page as if it were a public file, exposing name, balance and card digits to anyone. PayPal paid him $3,000.", source: "https://omergil.blogspot.com/2017/02/web-cache-deception-attack.html" },
    // Source: https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/
    { text: "In February 2017 a Cloudflare bug leaked scraps of private data into web pages, and search engines saved copies in their caches. Cloudflare worked with Google, Bing and others to find and clear 770 cached pages.", source: "https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/" },
  ],
  "celery": [
    // Source: https://docs.celeryq.dev/en/stable/userguide/security.html
    { text: "Celery's security guide calls the pickle message format inherently insecure, because it can carry almost any Python object. It also warns that workers trust whatever the broker sends, so the broker must be locked down.", source: "https://docs.celeryq.dev/en/stable/userguide/security.html" },
    // Source: https://pycon-archive.python.org/2013/schedule/presentation/106
    { text: "Celery runs slow jobs in the background so a web page does not have to wait. Instagram engineers said in a 2013 talk that they used it as their traffic grew to thousands of tasks every second.", source: "https://pycon-archive.python.org/2013/schedule/presentation/106" },
  ],
  "clerk": [
    // Source: https://clerk.com/changelog/2024-01-12
    { text: "In January 2024 Clerk found a critical flaw in its Next.js package during an internal audit. Attackers could have acted as other users, so Vercel, Netlify and Cloudflare added temporary blocks while apps upgraded.", source: "https://clerk.com/changelog/2024-01-12" },
    // Source: https://clerk.com/blog/postmortem-feb-6-2025-service-outage
    { text: "On February 6, 2025, one faulty database query at Clerk broke sign-in for about 3,700 of its customers at once. It took 26 minutes to undo.", source: "https://clerk.com/blog/postmortem-feb-6-2025-service-outage" },
  ],
  "client-server-boundary": [
    // Source: https://fortune.com/2016/04/05/hacker-free-dominos-pizza/
    { text: "In 2016 a UK researcher ordered a Domino's pizza with a fake card number. The Android app trusted the payment answer it was sent, so he changed \"declined\" to \"accepted\" on his own phone and the order went through.", source: "https://fortune.com/2016/04/05/hacker-free-dominos-pizza/" },
    // Source: https://mattpalmer.io/posts/CVE-2025-48757/
    { text: "In 2025 a researcher found that apps built with the AI tool Lovable talked to their database straight from the browser and often lacked access rules. Strangers could read users' emails and API keys, and even change payment status.", source: "https://mattpalmer.io/posts/CVE-2025-48757/" },
    // Source: https://www.malwarebytes.com/blog/news/2025/03/research-on-ios-apps-shows-widespread-exposure-of-secrets
    { text: "A 2025 Cybernews study of about 156,000 iPhone apps found that 71% had at least one secret, such as an API key, packed inside the app. It counted more than 815,000 secrets, about 5 per app.", source: "https://www.malwarebytes.com/blog/news/2025/03/research-on-ios-apps-shows-widespread-exposure-of-secrets" },
    // Source: https://www.malwarebytes.com/blog/news/2025/09/popeyes-tim-hortons-burger-king-platforms-have-catastrophic-vulnerabilities-say-hackers
    { text: "In 2025 two researchers found that an equipment ordering site for Burger King's parent company kept its password inside the web page's own HTML, where any visitor could read it. The company runs over 32,000 restaurants.", source: "https://www.malwarebytes.com/blog/news/2025/09/popeyes-tim-hortons-burger-king-platforms-have-catastrophic-vulnerabilities-say-hackers" },
    // Source: https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys
    { text: "In 2026 the vibe-coded site Moltbook left its database key in browser code with no access rules behind it. Researchers could read and change everything, including 1.5 million API tokens and 35,000 email addresses.", source: "https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys" },
    // Source: https://krebsonsecurity.com/2021/10/missouri-governor-vows-to-prosecute-st-louis-post-dispatch-for-reporting-security-vulnerability/
    { text: "In 2021 a reporter found that a Missouri state website sent teachers' Social Security numbers inside its page source, with more than 100,000 exposed. Anyone could read them using the browser's view source option.", source: "https://krebsonsecurity.com/2021/10/missouri-governor-vows-to-prosecute-st-louis-post-dispatch-for-reporting-security-vulnerability/" },
    // Source: https://www.bleepingcomputer.com/news/security/over-3-200-apps-leak-twitter-api-keys-some-allowing-account-hijacks/
    { text: "The security firm CloudSEK found 3,207 mobile apps that shipped with their Twitter API keys inside. Anything packed into an app or web page can be pulled out by whoever downloads it.", source: "https://www.bleepingcomputer.com/news/security/over-3-200-apps-leak-twitter-api-keys-some-allowing-account-hijacks/" },
    // Source: https://www.bleepingcomputer.com/news/security/misconfigured-firebase-instances-leaked-19-million-plaintext-passwords/
    { text: "Researchers scanned over five million sites and found 916 with open Firebase databases, because security rules were missing or wrong. They exposed about 125 million user records and nearly 19 million plain text passwords.", source: "https://www.bleepingcomputer.com/news/security/misconfigured-firebase-instances-leaked-19-million-plaintext-passwords/" },
  ],
  "cloudinary": [
    // Source: https://cloudinary.com/blog/building_and_scaling_a_service_for_developers_the_bootstrapped_way
    { text: "Cloudinary's founders started it after years of building web apps where handling images took too much work. Cloudinary's team wrote in 2015 that it had reached 2,000 paying customers with zero outside funding.", source: "https://cloudinary.com/blog/building_and_scaling_a_service_for_developers_the_bootstrapped_way" },
  ],
  "container-image": [
    // Source: https://www.bleepingcomputer.com/news/security/17-backdoored-docker-images-removed-from-docker-hub/
    { text: "In 2018 Docker removed 17 images with hidden backdoors that one account had kept on Docker Hub for about a year. Some had over a million installs, and one scheme mined about $90,000 of cryptocurrency.", source: "https://www.bleepingcomputer.com/news/security/17-backdoored-docker-images-removed-from-docker-hub/" },
    // Source: https://www.bleepingcomputer.com/news/security/thousands-of-images-on-docker-hub-leak-auth-secrets-private-keys/
    { text: "University researchers studied 337,171 Docker images from Docker Hub and private registries and found about 8.5% contained secrets. They found 52,107 valid private keys and 3,158 API secrets.", source: "https://www.bleepingcomputer.com/news/security/thousands-of-images-on-docker-hub-leak-auth-secrets-private-keys/" },
    // Source: https://about.codecov.io/security-update/
    { text: "In 2021 a mistake in how Codecov built its Docker image let an attacker extract a credential. For two months the attacker used it to alter a script so it sent customers' secrets to an outside server.", source: "https://about.codecov.io/security-update/" },
    // Source: https://www.bleepingcomputer.com/news/security/over-10-000-docker-hub-images-found-leaking-credentials-auth-keys/
    { text: "Security firm Flare scanned the images uploaded to Docker Hub in a single month and found 10,456 that exposed keys. About 4,000 of those keys were access tokens for AI models.", source: "https://www.bleepingcomputer.com/news/security/over-10-000-docker-hub-images-found-leaking-credentials-auth-keys/" },
    // Source: https://sysdig.com/blog/analysis-of-supply-chain-attacks-through-public-docker-images/
    { text: "Security firm Sysdig analysed over 250,000 public Docker images and found 1,652 that were malicious. The most common kind secretly mined cryptocurrency on whatever machine ran the image.", source: "https://sysdig.com/blog/analysis-of-supply-chain-attacks-through-public-docker-images/" },
    // Source: https://jfrog.com/blog/attacks-on-docker-with-millions-of-malicious-repositories-spread-malware-and-phishing-scams/
    { text: "In 2024 JFrog found about 2.8 million Docker Hub repositories, nearly 20% of all public ones, that held no real image. They existed to push fake downloads and phishing pages, and Docker removed them.", source: "https://jfrog.com/blog/attacks-on-docker-with-millions-of-malicious-repositories-spread-malware-and-phishing-scams/" },
    // Source: https://unit42.paloaltonetworks.com/cryptojacking-docker-images-for-mining-monero/
    { text: "In 2020 Palo Alto Networks found six Docker Hub images from one account, azurenql, that secretly mined cryptocurrency. They had been pulled more than 2 million times, and one wallet had collected about $36,000.", source: "https://unit42.paloaltonetworks.com/cryptojacking-docker-images-for-mining-monero/" },
    // Source: https://www.theregister.com/2016/07/25/oops_bountyhunter_found_vines_source_code_in_plain_sight/
    { text: "In 2016 a researcher found that a Docker registry at Vine, meant to be private, let anyone download its images. One image held Vine's full source code and API keys, and Twitter paid him $10,080.", source: "https://www.theregister.com/2016/07/25/oops_bountyhunter_found_vines_source_code_in_plain_sight/" },
    // Source: https://talosintelligence.com/vulnerability_reports/TALOS-2019-0782
    { text: "Until fixed images came out in March 2019, official Alpine Linux Docker images from version 3.3 on had an empty root password. If a tool that checks passwords was added, someone could log in as root with none.", source: "https://talosintelligence.com/vulnerability_reports/TALOS-2019-0782" },
  ],
  "cors": [
    // Source: https://techcrunch.com/2019/07/10/apple-silent-update-zoom-app
    { text: "Zoom's Mac app once installed a hidden web server on each computer. In 2019 a researcher showed that any website could use it to put a visitor into a video call with the camera on, and Apple removed it with a silent update.", source: "https://techcrunch.com/2019/07/10/apple-silent-update-zoom-app" },
    // Source: https://www.theregister.com/2018/01/23/blizzard_games_vulnerability/
    { text: "In 2018 a Google researcher found that any website could send commands to the update tool installed with every Blizzard game. The tool listened on the player's own computer, and a DNS trick got past the browser's same-origin rule.", source: "https://www.theregister.com/2018/01/23/blizzard_games_vulnerability/" },
    // Source: https://github.blog/news-insights/the-library/new-github-pages-domain-github-io/
    { text: "In April 2013 GitHub moved every user-made Pages site from github.com to a new domain, github.io. Pages on the same domain could run scripts that tampered with github.com cookies, so GitHub gave them a separate origin.", source: "https://github.blog/news-insights/the-library/new-github-pages-domain-github-io/" },
    // Source: https://en.wikipedia.org/wiki/Site_isolation
    { text: "After the Spectre chip flaws were revealed in 2018, Chrome sped up work to run each site in its own process, so one site cannot read another's data. Engineers measured the cost at 10 to 13% more memory.", source: "https://en.wikipedia.org/wiki/Site_isolation" },
    // Source: https://portswigger.net/research/exploiting-cors-misconfigurations-for-bitcoins-and-bounties
    { text: "A researcher found a bitcoin exchange whose CORS setup trusted any website. A malicious page could have stolen logged-in users' private API keys and moved their funds, and the fix took 20 minutes.", source: "https://portswigger.net/research/exploiting-cors-misconfigurations-for-bitcoins-and-bounties" },
    // Source: https://www.oligo.security/blog/0-0-0-0-day-exploiting-localhost-apis-from-the-browser
    { text: "In 2024 researchers showed that websites could reach programs running on a visitor's own Mac or Linux computer through the address 0.0.0.0, in every major browser. The first bug report about it was 18 years old.", source: "https://www.oligo.security/blog/0-0-0-0-day-exploiting-localhost-apis-from-the-browser" },
  ],
  "css-layout": [
    // Source: https://web.dev/case-studies/yahoo-japan-news
    { text: "Yahoo Japan News fixed parts of its pages that jumped around while loading. Page views per visit rose 15.1% and visits lasted 13.3% longer.", source: "https://web.dev/case-studies/yahoo-japan-news" },
    // Source: https://web.dev/case-studies/vitals-business-impact
    { text: "Recipe site iCook reduced how much its page layout shifted during loading by 15%. Its ad revenue went up 10%.", source: "https://web.dev/case-studies/vitals-business-impact" },
    // Source: https://web.dev/case-studies/vitals-business-impact
    { text: "Comic site Ameba Manga made its page layout 10 times more stable while loading. The number of comics people read went up 2 to 3 times.", source: "https://web.dev/case-studies/vitals-business-impact" },
    // Source: https://web.dev/case-studies/vitals-business-impact
    { text: "Italian publisher GEDI cut layout shift on its pages by 77%. The share of visitors who left straight away fell by 8%.", source: "https://web.dev/case-studies/vitals-business-impact" },
    // Source: https://web.dev/case-studies/vitals-business-impact
    { text: "Bus ticket site redBus cut its layout shift score from 1.65 to 0, so nothing on the page jumped while loading. Together with other speed fixes, its mobile sales rate rose by 80 to 100%.", source: "https://web.dev/case-studies/vitals-business-impact" },
    // Source: https://web.dev/case-studies/vitals-business-impact
    { text: "AliExpress made its page layout 10 times more stable while loading and doubled how fast the main content appeared. Its bounce rate, the share of visitors who leave straight away, fell by 15%.", source: "https://web.dev/case-studies/vitals-business-impact" },
    // Source: https://en.wikipedia.org/wiki/National_Federation_of_the_Blind_v._Target_Corp.
    { text: "In 2008 Target agreed to pay $6 million to settle a lawsuit from the National Federation of the Blind, which said blind people could not use Target.com. A judge later added $3.7 million in legal fees.", source: "https://en.wikipedia.org/wiki/National_Federation_of_the_Blind_v._Target_Corp." },
    // Source: https://en.wikipedia.org/wiki/2000_United_States_presidential_election_in_Florida
    { text: "In the 2000 US election, the layout of Palm Beach County's butterfly ballot sent over 2,000 votes meant for Al Gore to Pat Buchanan. George Bush won Florida, and the presidency, by 537 votes.", source: "https://en.wikipedia.org/wiki/2000_United_States_presidential_election_in_Florida" },
  ],
  "cypress": [
    // Source: https://cypress.io/blog/update-defense-intellectual-property
    { text: "In 2023 Cypress began blocking a module that sent test results to Sorry-Cypress and Currents, two outside services, starting with version 13. Cypress said they had copied its brand and its paid cloud product.", source: "https://cypress.io/blog/update-defense-intellectual-property" },
    // Source: https://docs.cypress.io/app/references/trade-offs
    { text: "Cypress runs your test code inside the browser, next to your app, and its docs list this as a permanent trade-off. The docs also say Cypress tests must be written in JavaScript and cannot drive two browsers at once.", source: "https://docs.cypress.io/app/references/trade-offs" },
  ],
  "db-schema": [
    // Source: https://github.blog/2021-12-01-github-availability-report-november-2021/
    { text: "On 27 November 2021 a schema migration on one large table at GitHub locked up its database copies during the final rename step. Core GitHub services were degraded for 2 hours 50 minutes.", source: "https://github.blog/2021-12-01-github-availability-report-november-2021/" },
    // Source: https://resend.com/blog/incident-report-for-february-21-2024
    { text: "In February 2024 an engineer at email service Resend ran a database migration that pointed at production by mistake and dropped every table. Customers could not send email for about 12 hours.", source: "https://resend.com/blog/incident-report-for-february-21-2024" },
    // Source: https://signalvnoise.com/svn3/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/
    { text: "In November 2018 the ID column in Basecamp's busiest table hit 2,147,483,647, the largest number its type could hold. Basecamp 3 was stuck in read-only mode for almost five hours.", source: "https://signalvnoise.com/svn3/postmortem-on-the-read-only-outage-of-basecamp-on-november-9th-2018/" },
    // Source: https://www.chess.com/news/view/the-unique-reason-the-broken-now-fixed-chess-com-app-made-headlines-6918
    { text: "In June 2017 the Chess.com app stopped working on older iPhones and iPads. The site had passed 2,147,483,647 games, and those 32-bit devices could not hold a game ID that large.", source: "https://www.chess.com/news/view/the-unique-reason-the-broken-now-fixed-chess-com-app-made-headlines-6918" },
    // Source: https://kottke.org/06/11/slashdot-recently-crossed-16777216-thats-224-comments-after-which
    { text: "In November 2006 the news site Slashdot passed 16,777,216 comments, the highest number its database setup could count to. No more comments could be added until the setup was changed.", source: "https://kottke.org/06/11/slashdot-recently-crossed-16777216-thats-224-comments-after-which" },
    // Source: https://techcrunch.com/2009/06/12/all-hell-may-break-loose-on-twitter-in-2-hours
    { text: "On 12 June 2009 tweet ID numbers were due to pass 2,147,483,647. Twitter warned that outside apps storing IDs in a number type that stopped there were likely to crash, and the day was nicknamed the Twitpocalypse.", source: "https://techcrunch.com/2009/06/12/all-hell-may-break-loose-on-twitter-in-2-hours" },
    // Source: https://mailchimp.com/what-we-learned-from-the-recent-mandrill-outage/
    { text: "In February 2019 a database at Mailchimp's Mandrill email service ran out of transaction ID numbers and shut itself down for safety. The outage lasted about 40 hours, and engineers had noted the risk three months earlier.", source: "https://mailchimp.com/what-we-learned-from-the-recent-mandrill-outage/" },
    // Source: https://www.fca.org.uk/news/press-releases/tsb-fined-48m-operational-resilience-failings
    { text: "In April 2018 the UK bank TSB moved its customer records to a new computer platform and the move went wrong. A large share of its 5.2 million customers were affected, and regulators fined the bank £48.65 million.", source: "https://www.fca.org.uk/news/press-releases/tsb-fined-48m-operational-resilience-failings" },
  ],
  "db-transaction": [
    // Source: https://www.pcworld.com/article/444202/withdrawal-vulnerabilities-enabled-bitcoin-theft-from-flexcoin-and-poloniex.html
    { text: "In March 2014 a thief sent thousands of transfer requests at once to the bitcoin bank Flexcoin, before balances could update. 896 bitcoins worth about $600,000 were taken and Flexcoin closed down.", source: "https://www.pcworld.com/article/444202/withdrawal-vulnerabilities-enabled-bitcoin-theft-from-flexcoin-and-poloniex.html" },
    // Source: https://sakurity.com/blog/2015/05/21/starbucks.html
    { text: "In 2015 a researcher sent two transfer requests at the same instant between Starbucks gift cards, and the same $5 moved twice. He turned $15 of cards into $20 and reported the flaw.", source: "https://sakurity.com/blog/2015/05/21/starbucks.html" },
    // Source: https://www.pcworld.com/article/444202/withdrawal-vulnerabilities-enabled-bitcoin-theft-from-flexcoin-and-poloniex.html
    { text: "In March 2014 a thief placed several withdrawals at the same instant on the exchange Poloniex, pushing a balance below zero. Poloniex lost 12.3 percent of its funds because nothing checked for it.", source: "https://www.pcworld.com/article/444202/withdrawal-vulnerabilities-enabled-bitcoin-theft-from-flexcoin-and-poloniex.html" },
    // Source: https://en.wikipedia.org/wiki/The_DAO
    { text: "On 17 June 2016 an attacker drained about 3.6 million ether, worth roughly $50 million, from an investment fund called The DAO. A flaw in its code let a withdrawal call itself again and again.", source: "https://en.wikipedia.org/wiki/The_DAO" },
    // Source: https://en.wikipedia.org/wiki/2024_Commercial_Bank_of_Ethiopia_glitch_incident
    { text: "On 15 March 2024 a glitch at the Commercial Bank of Ethiopia let customers take out more money than their accounts held. Millions of dollars left the bank overnight, and it later asked customers to return it.", source: "https://en.wikipedia.org/wiki/2024_Commercial_Bank_of_Ethiopia_glitch_incident" },
    // Source: https://www.nbcconnecticut.com/news/business/money-report/tesla-double-charged-some-customers-for-new-cars-leaving-them-desperate-for-refund-details/2455453/
    { text: "In March 2021 Tesla took payment twice from some people buying new cars. CNBC spoke to buyers who were out an extra $37,000 to $71,000 and said they struggled to get refunds.", source: "https://www.nbcconnecticut.com/news/business/money-report/tesla-double-charged-some-customers-for-new-cars-leaving-them-desperate-for-refund-details/2455453/" },
    // Source: https://blog.acolyer.org/2017/08/07/acidrain-concurrency-related-attacks-on-database-backed-web-applications/
    { text: "In 2017 researchers tested 12 popular online shop programs, used by over 2 million websites, by sending requests at the same instant. They found 22 flaws, such as spending the same gift card more than once.", source: "https://blog.acolyer.org/2017/08/07/acidrain-concurrency-related-attacks-on-database-backed-web-applications/" },
  ],
  "dependency-added": [
    // Source: https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm
    { text: "In March 2016 a developer removed his 11-line package, left-pad, from npm. Projects that depended on it, including React and Babel, could not be built until npm restored it about two and a half hours later.", source: "https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm" },
    // Source: https://en.wikipedia.org/wiki/XZ_Utils_backdoor
    { text: "In March 2024 a hidden backdoor was found in xz, a compression tool that many Linux systems include. It was planted by a contributor who had spent over two years earning the project's trust.", source: "https://en.wikipedia.org/wiki/XZ_Utils_backdoor" },
    // Source: https://en.wikipedia.org/wiki/Log4Shell
    { text: "In December 2021 a flaw became public in Log4j, a logging library built into a huge number of Java programs. It had gone unnoticed since 2013 and was rated 10 out of 10 for severity.", source: "https://en.wikipedia.org/wiki/Log4Shell" },
    // Source: https://www.bleepingcomputer.com/news/security/dev-corrupts-npm-libs-colors-and-faker-breaking-thousands-of-apps/
    { text: "In January 2022 the author of colors, an npm package downloaded over 20 million times a week, released a version with an endless loop on purpose. Apps that used it printed gibberish without stopping.", source: "https://www.bleepingcomputer.com/news/security/dev-corrupts-npm-libs-colors-and-faker-breaking-thousands-of-apps/" },
    // Source: https://en.wikipedia.org/wiki/2017_Equifax_data_breach
    { text: "In 2017 attackers got into Equifax through Apache Struts, a library its website used, about two months after a fix came out. Private records of 147.9 million Americans were taken.", source: "https://en.wikipedia.org/wiki/2017_Equifax_data_breach" },
    // Source: https://snyk.io/blog/a-post-mortem-of-the-malicious-event-stream-backdoor/
    { text: "In 2018 the maintainer of the npm package event-stream handed it over to a stranger who offered to help. The stranger added code that stole bitcoin, and it was downloaded millions of times.", source: "https://snyk.io/blog/a-post-mortem-of-the-malicious-event-stream-backdoor/" },
    // Source: https://www.bleepingcomputer.com/news/security/researcher-hacks-over-35-tech-firms-in-novel-supply-chain-attack/
    { text: "In 2021 researcher Alex Birsan uploaded public packages with the same names as companies' private ones, and build tools pulled his in instead. His code ran inside Apple, Microsoft, Tesla and over 30 others, earning him $130,000.", source: "https://www.bleepingcomputer.com/news/security/researcher-hacks-over-35-tech-firms-in-novel-supply-chain-attack/" },
    // Source: https://snyk.io/blog/peacenotwar-malicious-npm-node-ipc-package-vulnerability/
    { text: "In March 2022 the maintainer of node-ipc, an npm package with about 1 million weekly downloads, added code that overwrote files with heart emojis on computers located in Russia or Belarus. It was a protest over the war.", source: "https://snyk.io/blog/peacenotwar-malicious-npm-node-ipc-package-vulnerability/" },
    // Source: https://krebsonsecurity.com/2025/09/18-popular-code-packages-hacked-rigged-to-steal-crypto/
    { text: "In September 2025 a fake email asking an npm maintainer to update his two-step login captured his password and code. Attackers then added crypto-stealing code to 18 packages downloaded over 2 billion times a week.", source: "https://krebsonsecurity.com/2025/09/18-popular-code-packages-hacked-rigged-to-steal-crypto/" },
    // Source: https://krebsonsecurity.com/2025/09/self-replicating-worm-hits-180-software-packages/
    { text: "In September 2025 a worm named Shai-Hulud spread through npm. When a developer installed an infected package, it stole their npm token and copied itself into up to 20 more of their packages, reaching at least 187.", source: "https://krebsonsecurity.com/2025/09/self-replicating-worm-hits-180-software-packages/" },
    // Source: https://sansec.io/research/polyfill-supply-chain-attack
    { text: "In February 2024 a company bought the polyfill.io domain, whose script more than 100,000 websites loaded directly. By June the script was sending some mobile visitors to a sports betting site.", source: "https://sansec.io/research/polyfill-supply-chain-attack" },
    // Source: https://www.theregister.com/2024/03/28/ai_bots_hallucinate_software_packages/
    { text: "A researcher noticed AI chatbots kept recommending a Python package named huggingface-cli that did not exist, so he published an empty one under that name. It was downloaded more than 15,000 times in three months.", source: "https://www.theregister.com/2024/03/28/ai_bots_hallucinate_software_packages/" },
  ],
  "django": [
    // Source: https://securityaffairs.com/70869/hacking/django-apps-misconfigured.html
    { text: "In March 2018 a researcher found 28,165 Django sites running with debug mode left on. Their error pages showed strangers things like passwords, API keys and AWS access tokens.", source: "https://securityaffairs.com/70869/hacking/django-apps-misconfigured.html" },
    // Source: https://en.wikipedia.org/wiki/Django_(web_framework)
    { text: "Django was built in 2003 by web programmers at a newspaper, the Lawrence Journal-World. They named it after the jazz guitarist Django Reinhardt and released it to the public in 2005.", source: "https://en.wikipedia.org/wiki/Django_(web_framework)" },
  ],
  "docker": [
    // Source: https://www.docker.com/blog/we-apologize-we-did-a-terrible-job-announcing-the-end-of-docker-free-teams/
    { text: "In March 2023 Docker told groups on its Free Team plan to move to another plan or lose features, which alarmed open source projects. Docker apologised on 16 March and reversed the decision on 24 March.", source: "https://www.docker.com/blog/we-apologize-we-did-a-terrible-job-announcing-the-end-of-docker-free-teams/" },
    // Source: https://www.theregister.com/2025/08/26/docker_desktop_bug/
    { text: "In August 2025 a flaw rated 9.3 out of 10 was fixed in Docker Desktop. Any container on Windows or Mac could reach Docker's control API with no password, and on Windows could read and write the whole C: drive.", source: "https://www.theregister.com/2025/08/26/docker_desktop_bug/" },
    // Source: https://en.wikipedia.org/wiki/Docker_(software)
    { text: "Docker started as an internal project at a hosting company called dotCloud and was first shown to the public at the PyCon conference in 2013. The company renamed itself Docker Inc that same year.", source: "https://en.wikipedia.org/wiki/Docker_(software)" },
    // Source: https://www.securityweek.com/docker-hub-breach-hits-190000-accounts/
    { text: "In April 2019 an attacker broke into a Docker Hub database holding data for about 190,000 accounts. It exposed some usernames and password hashes, plus GitHub and Bitbucket tokens used for automatic builds.", source: "https://www.securityweek.com/docker-hub-breach-hits-190000-accounts/" },
  ],
  "drizzle": [
    // Source: https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9
    { text: "In April 2026 Drizzle ORM fixed an SQL injection flaw rated 7.5 out of 10. Apps that built column names from user input, such as a sort field, could have their queries rewritten by an attacker.", source: "https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9" },
    // Source: https://planetscale.com/blog/drizzle-joins-planetscale
    { text: "In March 2026, the database company PlanetScale hired the whole team behind Drizzle ORM. Both sides said Drizzle would stay an independent open source project with its own roadmap.", source: "https://planetscale.com/blog/drizzle-joins-planetscale" },
  ],
  "env-vars": [
    // Source: https://www.theregister.com/2021/09/15/travis_ci_leak/
    { text: "For about a week in September 2021, a Travis CI bug let a pull request from a copy of a public project collect that project's secret environment variables, such as keys and tokens. An Ethereum developer spotted the leak.", source: "https://www.theregister.com/2021/09/15/travis_ci_leak/" },
    // Source: https://www.theregister.com/2022/05/24/pypi_ctx_package_compromised/
    { text: "In May 2022 an attacker took over the Python package ctx by registering its maintainer's expired email domain. The new version sent every environment variable on the machine to the attacker and was downloaded about 27,000 times.", source: "https://www.theregister.com/2022/05/24/pypi_ctx_package_compromised/" },
    // Source: https://blog.gitguardian.com/exploiting-public-app_key-leaks/
    { text: "GitGuardian reported in 2025 that about 260,000 Laravel app keys had been exposed on GitHub since 2018, and 63% of them came from .env files. The research found 600 apps that could be taken over with a leaked key.", source: "https://blog.gitguardian.com/exploiting-public-app_key-leaks/" },
    // Source: https://www.aquasec.com/blog/travis-ci-security/
    { text: "In 2022 Aqua Security found about 770 million Travis CI build logs that anyone could read. A sample of roughly 1% of them held about 73,000 tokens, secrets and passwords that builds had printed into the logs.", source: "https://www.aquasec.com/blog/travis-ci-security/" },
    // Source: https://unit42.paloaltonetworks.com/large-scale-cloud-extortion-operation/
    { text: "Attackers hunted for .env files left reachable on websites and targeted 110,000 domains. They collected over 90,000 variables, including 7,000 cloud access keys, then emptied victims' cloud storage and left ransom notes.", source: "https://unit42.paloaltonetworks.com/large-scale-cloud-extortion-operation/" },
    // Source: https://about.codecov.io/security-update/
    { text: "From January 31 to April 1, 2021, a tampered Codecov script could quietly send customers' environment variables to an outside server. It was caught when one customer noticed the file's checksum did not match.", source: "https://about.codecov.io/security-update/" },
    // Source: https://vercel.com/kb/bulletin/vercel-april-2026-security-incident
    { text: "In April 2026 an attacker inside Vercel's systems read customers' environment variables that had not been marked sensitive. Vercel told those customers to replace API keys, tokens and database passwords.", source: "https://vercel.com/kb/bulletin/vercel-april-2026-security-incident" },
    // Source: https://circleci.com/blog/jan-4-2023-incident-report/
    { text: "In December 2022 an attacker inside CircleCI's systems copied customers' environment variables, tokens and keys. CircleCI told customers to assume every secret stored there had been seen and to replace them all.", source: "https://circleci.com/blog/jan-4-2023-incident-report/" },
  ],
  "error-handling": [
    // Source: https://blog.cloudflare.com/18-november-2025-outage/
    { text: "On 18 November 2025 a settings file at Cloudflare grew to twice its normal size, and the code reading it crashed instead of coping. Sites behind Cloudflare returned errors for nearly 6 hours.", source: "https://blog.cloudflare.com/18-november-2025-outage/" },
    // Source: https://en.wikipedia.org/wiki/USS_Yorktown_(CG-48)
    { text: "In 1997 a sailor typed a zero into a database on the US Navy ship USS Yorktown. The software tried to divide by it and crashed, and the warship sat dead in the water for more than two hours.", source: "https://en.wikipedia.org/wiki/USS_Yorktown_(CG-48)" },
    // Source: https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW
    { text: "On 12 June 2025 new code at Google Cloud met blank fields it had no error handling for and crashed. More than 50 Google services were disrupted, some for hours.", source: "https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW" },
    // Source: https://www.nats.aero/news/nats-report-into-air-traffic-control-incident-details-root-cause-and-solution-implemented/
    { text: "In August 2023 one flight plan with two waypoints of the same name made the UK flight planning system and its backup both stop. Over 700,000 passengers were affected.", source: "https://www.nats.aero/news/nats-report-into-air-traffic-control-incident-details-root-cause-and-solution-implemented/" },
    // Source: https://blog.cloudflare.com/5-december-2025-outage/
    { text: "On 5 December 2025 code at Cloudflare tried to read a value that was not there, and nothing handled the error. About 28% of the web traffic Cloudflare carried failed for around 25 minutes.", source: "https://blog.cloudflare.com/5-december-2025-outage/" },
    // Source: https://en.wikipedia.org/wiki/Schiaparelli_EDM
    { text: "In 2016 a sensor on Europe's Schiaparelli Mars lander maxed out for about a second, and its software worked out a height below ground level. It acted as if it had landed while still 3.7 km up, and crashed.", source: "https://en.wikipedia.org/wiki/Schiaparelli_EDM" },
    // Source: https://blog.acolyer.org/2016/10/06/simple-testing-can-prevent-most-critical-failures/
    { text: "A 2014 study of 198 real failures in large data systems such as Cassandra and Hadoop found that 92% of the most severe ones came from badly handled errors that should not have been fatal.", source: "https://blog.acolyer.org/2016/10/06/simple-testing-can-prevent-most-critical-failures/" },
    // Source: https://www.theregister.com/2020/05/08/facebook_sdk_snafu_ios
    { text: "On 6 May 2020 Facebook's servers sent a setting of the wrong type to Facebook code built into other companies' iPhone apps. Spotify, TikTok, Tinder and others crashed on opening until Facebook fixed it hours later.", source: "https://www.theregister.com/2020/05/08/facebook_sdk_snafu_ios" },
  ],
  "eslint": [
    // Source: https://archive.eslint.org/blog/2021/11/the-inception-of-eslint
    { text: "ESLint began after a bug at Box that only broke the app in Internet Explorer 7. Nicholas Zakas asked the JSHint maintainer about plugins, heard the idea had stalled, and built his own linter over a couple of weekends.", source: "https://archive.eslint.org/blog/2021/11/the-inception-of-eslint" },
    // Source: https://eslint.org/blog/2018/07/postmortem-for-malicious-package-publishes/
    { text: "In July 2018 an attacker got into an ESLint maintainer's npm account, which reused a password and had no two-factor login. The fake releases they published stole npm login tokens from anyone who installed them.", source: "https://eslint.org/blog/2018/07/postmortem-for-malicious-package-publishes/" },
  ],
  "express": [
    // Source: https://en.wikipedia.org/wiki/Express.js
    { text: "Express changed hands three times in two years. In 2014 StrongLoop got the rights to manage it, IBM bought StrongLoop in 2015, and in 2016 IBM said Express would move under the Node.js Foundation.", source: "https://en.wikipedia.org/wiki/Express.js" },
    // Source: https://expressjs.com/en/blog/2024-10-15-v5-release
    { text: "The pull request for Express version 5 was opened in July 2014. Version 5.0.0 was finally published in September 2024, about ten years later.", source: "https://expressjs.com/en/blog/2024-10-15-v5-release" },
  ],
  "fastapi": [
    // Source: https://fastapi.tiangolo.com/history-design-future/
    { text: "FastAPI's creator wrote that he avoided making a new framework for several years and tried existing tools first. He then spent several months studying standards such as OpenAPI before writing any code.", source: "https://fastapi.tiangolo.com/history-design-future/" },
    // Source: https://lp.jetbrains.com/python-developers-survey-2024/
    { text: "In an official survey of more than 25,000 Python developers, FastAPI use jumped from 29% in 2023 to 38% in 2024. That put it ahead of both Django and Flask.", source: "https://lp.jetbrains.com/python-developers-survey-2024/" },
  ],
  "fastify": [
    // Source: https://github.com/fastify/fastify/security/advisories/GHSA-jx2c-rxcm-jvmq
    { text: "In February 2026 Fastify fixed a flaw rated 7.5 out of 10. Adding a single tab character to a request's Content-Type header made Fastify skip its checks on the request body.", source: "https://github.com/fastify/fastify/security/advisories/GHSA-jx2c-rxcm-jvmq" },
    // Source: https://blog.platformatic.dev/a-tale-of-community-how-the-quest-for-better-performance-led-to-fastify-and-grew-into-platformatic
    { text: "Fastify began in 2016 when a student at a Node.js course in Bologna asked the teacher, Matteo Collina, how to get into open source. Collina asked him to build a framework together, and the first commit landed that September.", source: "https://blog.platformatic.dev/a-tale-of-community-how-the-quest-for-better-performance-led-to-fastify-and-grew-into-platformatic" },
  ],
  "file-upload": [
    // Source: https://securityaffairs.com/wordpress/112407/hacking/contact-form-7-flaw.html
    { text: "In December 2020 a flaw was found in Contact Form 7, a WordPress plugin on over 5 million sites. A specially named file could slip past its upload checks, letting an attacker put a script on the server and run it.", source: "https://securityaffairs.com/wordpress/112407/hacking/contact-form-7-flaw.html" },
    // Source: https://www.securityweek.com/facebook-awards-40000-bounty-imagetragick-hack/
    { text: "In 2016 a researcher made Facebook's servers run his commands by getting them to process a crafted image. The image tool had a known flaw called ImageTragick, and Facebook paid him $40,000, its largest bounty at the time.", source: "https://www.securityweek.com/facebook-awards-40000-bounty-imagetragick-hack/" },
    // Source: https://www.theregister.com/2018/10/22/jquery_file_flaw
    { text: "In 2018 an Akamai researcher found that jQuery File Upload, a popular upload tool, had let strangers upload and run code on many web servers for about eight years. Its code had been copied into 7,828 other projects.", source: "https://www.theregister.com/2018/10/22/jquery_file_flaw" },
    // Source: https://security.snyk.io/research/zip-slip-vulnerability
    { text: "In 2018 Snyk disclosed Zip Slip: a zip file with entries named like ../../evil.sh could write files outside the intended folder when unpacked. It affected thousands of projects, including ones from Amazon, Google and Oracle.", source: "https://security.snyk.io/research/zip-slip-vulnerability" },
    // Source: https://en.wikipedia.org/wiki/Zip_bomb
    { text: "A well-known file called 42.zip is only 42 kilobytes, yet it unpacks to about 4.5 petabytes, which is millions of gigabytes. A server that unzips uploads without a size limit can be filled by one tiny file.", source: "https://en.wikipedia.org/wiki/Zip_bomb" },
    // Source: https://www.rapid7.com/blog/post/2021/11/01/gitlab-unauthenticated-remote-code-execution-cve-2021-22205-exploited-in-the-wild/
    { text: "A 2021 GitLab flaw let an attacker run commands on a server just by uploading a crafted image file. Researchers then found about half of nearly 60,000 internet-facing GitLab servers still unpatched.", source: "https://www.rapid7.com/blog/post/2021/11/01/gitlab-unauthenticated-remote-code-execution-cve-2021-22205-exploited-in-the-wild/" },
    // Source: https://blog.sucuri.net/2020/09/critical-vulnerability-file-manager-affecting-700k-wordpress-websites.html
    { text: "In 2020 a WordPress plugin installed on about 700,000 sites let any visitor upload files without logging in, enough to take over a site. One security firm saw attacks peak at over 10,000 an hour.", source: "https://blog.sucuri.net/2020/09/critical-vulnerability-file-manager-affecting-700k-wordpress-websites.html" },
  ],
  "firebase": [
    // Source: https://www.techzine.eu/news/applications/124668/leak-in-arc-browser-fixed-after-one-day
    { text: "In August 2024 a researcher found that wrong Firebase access rules in the Arc browser let an attacker run JavaScript in another user's browser. Arc's maker fixed it in a day and stopped using Firebase for new features.", source: "https://www.techzine.eu/news/applications/124668/leak-in-arc-browser-fixed-after-one-day" },
    // Source: https://www.bleepingcomputer.com/news/security/misconfigured-firebase-instances-leaked-19-million-plaintext-passwords/
    { text: "In 2024, three researchers scanned the web and found 916 sites with Firebase security rules missing or set up wrong. Those sites exposed about 125 million user records and 19 million plain text passwords.", source: "https://www.bleepingcomputer.com/news/security/misconfigured-firebase-instances-leaked-19-million-plaintext-passwords/" },
    // Source: https://www.engadget.com/cybersecurity/tea-app-suffers-breach-exposing-thousands-of-user-images-190731414.html
    { text: "In 2025, about 72,000 images from the dating safety app Tea leaked, including selfies and photo IDs. Reporters at 404 Media traced them to an exposed Firebase storage bucket.", source: "https://www.engadget.com/cybersecurity/tea-app-suffers-breach-exposing-thousands-of-user-images-190731414.html" },
    // Source: https://en.wikipedia.org/wiki/Firebase
    { text: "Firebase grew out of a chat tool called Envolve. Its founders noticed developers were using the chat to pass around things like game state instead of messages, so they built a product just for that.", source: "https://en.wikipedia.org/wiki/Firebase" },
    // Source: https://www.theregister.com/2020/12/10/google_cloud_over_run/
    { text: "In 2020, a startup's test app made 116 billion reads to its Firebase database overnight. The bill came to almost $72,000 despite a $7 budget, and Google later waived it as a one-time gesture.", source: "https://www.theregister.com/2020/12/10/google_cloud_over_run/" },
  ],
  "github-actions": [
    // Source: https://nx.dev/blog/s1ngularity-postmortem
    { text: "In August 2025 attackers hid commands in a pull request title that a GitHub Actions workflow in the Nx project then ran. They stole Nx's npm token and published infected versions that stayed up about 4 hours.", source: "https://nx.dev/blog/s1ngularity-postmortem" },
    // Source: https://www.theregister.com/2020/11/03/google_project_zero_github_flaw_deadline/
    { text: "In 2020 Google Project Zero found that GitHub Actions read commands from anything a step printed. GitHub asked for more time, Google refused on day 104, and GitHub began phasing out the set-env command.", source: "https://www.theregister.com/2020/11/03/google_project_zero_github_flaw_deadline/" },
    // Source: https://github.blog/open-source/maintainers/github-actions-update-helping-maintainers-combat-bad-actors/
    { text: "In 2021 people abused GitHub Actions to mine cryptocurrency by opening pull requests on other people's projects. Since then, a maintainer must approve workflow runs from first-time contributors.", source: "https://github.blog/open-source/maintainers/github-actions-update-helping-maintainers-combat-bad-actors/" },
    // Source: https://www.stepsecurity.io/blog/harden-runner-detection-tj-actions-changed-files-action-is-compromised
    { text: "In March 2025 a GitHub Actions add-on called tj-actions/changed-files, used in over 23,000 repositories, was hijacked. It printed projects' secret keys into their build logs.", source: "https://www.stepsecurity.io/blog/harden-runner-detection-tj-actions-changed-files-action-is-compromised" },
  ],
  "gitignore": [
    // Source: https://www.ftc.gov/news-events/news/press-releases/2018/04/uber-agrees-expanded-settlement-ftc-related-privacy-security-claims
    { text: "In 2016 intruders used an access key that an Uber engineer had posted on a code-sharing site to reach data on over 25 million users. Uber paid them $100,000 and did not disclose it until late 2017.", source: "https://www.ftc.gov/news-events/news/press-releases/2018/04/uber-agrees-expanded-settlement-ftc-related-privacy-security-claims" },
    // Source: https://www.bleepingcomputer.com/news/security/toyota-discloses-data-leak-after-access-key-exposed-on-github/
    { text: "In 2022 Toyota found that a secret access key had sat in a public GitHub repository for almost five years. It put the email addresses of 296,019 customers at risk.", source: "https://www.bleepingcomputer.com/news/security/toyota-discloses-data-leak-after-access-key-exposed-on-github/" },
    // Source: https://www.wiz.io/blog/38-terabytes-of-private-data-accidentally-exposed-by-microsoft-ai-researchers
    { text: "In 2023 researchers found an access link in a public Microsoft GitHub repository that opened 38 terabytes of private data. It included over 30,000 internal Teams messages and passwords to Microsoft services.", source: "https://www.wiz.io/blog/38-terabytes-of-private-data-accidentally-exposed-by-microsoft-ai-researchers" },
    // Source: https://www.theregister.com/2017/11/14/dxc_github_aws_keys_leaked/
    { text: "In 2017 code containing AWS keys was put in a public GitHub repository at the tech firm DXC. Within four days strangers used the keys to start 244 cloud servers and ran up a $64,000 bill.", source: "https://www.theregister.com/2017/11/14/dxc_github_aws_keys_leaked/" },
    // Source: https://blog.gitguardian.com/the-state-of-secrets-sprawl-2025/
    { text: "Security firm GitGuardian counted 23.8 million secrets, such as passwords and API keys, leaked in public GitHub repositories in 2024. It found that 70% of the secrets leaked in 2022 still worked.", source: "https://blog.gitguardian.com/the-state-of-secrets-sprawl-2025/" },
    // Source: https://smitka.me/open-git/
    { text: "In 2018 a researcher scanned 230 million websites and found 390,000 with their .git folder open to anyone. That folder can reveal a site's source code and any passwords stored in it.", source: "https://smitka.me/open-git/" },
    // Source: https://techcrunch.com/2024/01/26/mercedez-benz-token-exposed-source-code-github
    { text: "In September 2023 a Mercedes-Benz employee's GitHub token was published in a public repository. Researchers who found it in January 2024 said it opened the company's internal source code, which also held cloud keys.", source: "https://techcrunch.com/2024/01/26/mercedez-benz-token-exposed-source-code-github" },
    // Source: https://www.bleepingcomputer.com/news/security/internet-archive-breached-again-through-stolen-access-tokens/
    { text: "In October 2024 data on 31 million Internet Archive users was stolen. The hacker said the way in was a GitLab configuration file left exposed on a server, holding a login token that had been reachable for almost two years.", source: "https://www.bleepingcomputer.com/news/security/internet-archive-breached-again-through-stolen-access-tokens/" },
    // Source: https://sourcegraph.com/blog/security-update-august-2023
    { text: "On July 14, 2023 a Sourcegraph engineer accidentally committed code containing a live admin access token, and automated checks missed it. On August 30 an outsider used the token to make their own account a site admin.", source: "https://sourcegraph.com/blog/security-update-august-2023" },
    // Source: https://www.sysdig.com/blog/emeraldwhale
    { text: "In 2024 Sysdig uncovered a campaign that scanned the web for sites with their git config file exposed. The attackers collected more than 15,000 cloud credentials and logins for over 10,000 private repositories.", source: "https://www.sysdig.com/blog/emeraldwhale" },
  ],
  "hardcoded-secret": [
    // Source: https://www.bleepingcomputer.com/news/security/uber-hacked-internal-systems-breached-and-vulnerability-reports-stolen/
    { text: "In 2022 a hacker inside Uber's network said he found a script with an admin username and password written into it. By his account, that one login opened Uber's store of secrets for its other systems.", source: "https://www.bleepingcomputer.com/news/security/uber-hacked-internal-systems-breached-and-vulnerability-reports-stolen/" },
    // Source: https://en.wikipedia.org/wiki/Mirai_(malware)
    { text: "In 2016 the Mirai malware took over cameras and routers by trying about 60 factory usernames and passwords built into them. Its attack on the DNS firm Dyn made Twitter, Netflix and Reddit unreachable.", source: "https://en.wikipedia.org/wiki/Mirai_(malware)" },
    // Source: https://www.security.com/threat-intelligence/mobile-supply-chain-aws
    { text: "In 2022 Symantec found 1,859 phone apps with AWS keys written into their code, and 77% of the keys still worked. One shared key exposed over 300,000 fingerprints from five banking apps.", source: "https://www.security.com/threat-intelligence/mobile-supply-chain-aws" },
    // Source: https://www.engadget.com/rabbit-r1-security-issue-allegedly-leaves-sensitive-user-data-accessible-to-anybody-120024215.html
    { text: "In 2024 a group called Rabbitude said it found API keys written into the code of the Rabbit R1 AI gadget. The group said the keys let anyone read every reply the devices had given, while Rabbit said it knew of no data leak.", source: "https://www.engadget.com/rabbit-r1-security-issue-allegedly-leaves-sensitive-user-data-accessible-to-anybody-120024215.html" },
    // Source: https://www.ftc.gov/news-events/news/press-releases/2018/04/uber-agrees-expanded-settlement-ftc-related-privacy-security-claims
    { text: "In 2016 intruders used an access key that an Uber engineer had posted on a code-sharing site to download details of more than 25 million riders and drivers. Uber paid the intruders $100,000.", source: "https://www.ftc.gov/news-events/news/press-releases/2018/04/uber-agrees-expanded-settlement-ftc-related-privacy-security-claims" },
    // Source: https://krebsonsecurity.com/2025/05/xai-dev-leaks-api-key-for-private-spacex-tesla-llms/
    { text: "In 2025 an xAI employee published code on GitHub with an API key inside. It stayed exposed for about two months and opened at least 60 private AI models, some of which appeared to be tuned on SpaceX and Tesla data.", source: "https://krebsonsecurity.com/2025/05/xai-dev-leaks-api-key-for-private-spacex-tesla-llms/" },
  ],
  "hono": [
    // Source: https://github.com/honojs/hono/security/advisories/GHSA-f67f-6cw9-8mq4
    { text: "In January 2026 Hono fixed a flaw rated 8.2 out of 10 in its login token checks. In some setups the token itself could choose how it was verified, so an attacker could forge one and pass as another user.", source: "https://github.com/honojs/hono/security/advisories/GHSA-f67f-6cw9-8mq4" },
    // Source: https://hono.dev/docs/concepts/motivation
    { text: "Hono means flame in Japanese. Its author started it because he wanted to build an app on Cloudflare Workers and found no good framework that ran there.", source: "https://hono.dev/docs/concepts/motivation" },
  ],
  "http-fetch": [
    // Source: https://aws.amazon.com/message/41926/
    { text: "On 28 February 2017 a mistyped command took Amazon's S3 storage offline for about 4 hours. For the first two hours Amazon could not update its own status page, because the page depended on S3.", source: "https://aws.amazon.com/message/41926/" },
    // Source: https://www.fastly.com/blog/summary-of-june-8-outage
    { text: "On 8 June 2021 one customer's valid settings change triggered a bug at Fastly, and 85% of its network returned errors. Websites that relied on Fastly to deliver their pages failed along with it.", source: "https://www.fastly.com/blog/summary-of-june-8-outage" },
    // Source: https://blog.cloudflare.com/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage/
    { text: "On 12 September 2025 a bug in Cloudflare's dashboard made it call one internal API over and over. The repeat calls overwhelmed that service, and the dashboard was unavailable for about an hour.", source: "https://blog.cloudflare.com/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage/" },
    // Source: https://aws.amazon.com/message/12721/
    { text: "On 7 December 2021 a surge of connections overwhelmed part of AWS's internal network, and clients kept retrying. The retries added to the jam, and the congestion lasted about 7 hours.", source: "https://aws.amazon.com/message/12721/" },
    // Source: https://en.wikipedia.org/wiki/DDoS_attacks_on_Dyn
    { text: "On 21 October 2016 an attack on one DNS company, Dyn, made Twitter, Netflix, Spotify, Reddit and many other sites unreachable. Their own servers were running, but all of them depended on Dyn.", source: "https://en.wikipedia.org/wiki/DDoS_attacks_on_Dyn" },
    // Source: https://techcrunch.com/2018/12/07/heres-what-caused-yesterdays-o2-and-softbank-outages
    { text: "On 6 December 2018 a security certificate inside Ericsson's phone network software expired. Millions of O2 customers in the UK lost their mobile data, and SoftBank customers in Japan were hit the same day.", source: "https://techcrunch.com/2018/12/07/heres-what-caused-yesterdays-o2-and-softbank-outages" },
    // Source: https://status.cloud.google.com/incident/zall/20013
    { text: "On 14 December 2020 an automatic system wrongly cut the storage quota of Google's user login service, which failed for 47 minutes. Every Google Workspace app that needed a login, such as Gmail, went down.", source: "https://status.cloud.google.com/incident/zall/20013" },
    // Source: https://aws.amazon.com/message/5467D2/
    { text: "On 20 September 2015 some Amazon DynamoDB servers timed out waiting for an internal service and kept retrying. The retries kept that service overloaded, and the disruption lasted almost 5 hours.", source: "https://aws.amazon.com/message/5467D2/" },
  ],
  "input-validation": [
    // Source: https://en.wikipedia.org/wiki/SQL_Slammer
    { text: "In January 2003 the Slammer worm, only 376 bytes long, infected about 75,000 servers, most within 10 minutes. It overflowed a database program with oversized input, and most of Bank of America's 13,000 ATMs stopped working.", source: "https://en.wikipedia.org/wiki/SQL_Slammer" },
    // Source: https://en.bitcoin.it/wiki/Value_overflow_incident
    { text: "In August 2010 someone created about 184 billion bitcoins in a single transaction. The code did not check for amounts so large that their total overflowed, and a fix was released within five hours.", source: "https://en.bitcoin.it/wiki/Value_overflow_incident" },
    // Source: https://en.wikipedia.org/wiki/Stagefright_(bug)
    { text: "In 2015 a researcher showed that a specially crafted video message could take over an Android phone, usually with no action by the owner. An estimated 950 million devices, 95% of Android phones then, were exposed.", source: "https://en.wikipedia.org/wiki/Stagefright_(bug)" },
    // Source: https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/
    { text: "In 2017 a Cloudflare bug leaked scraps of private data, such as passwords and cookies, into other websites' pages. It was set off when a web page ended with a broken HTML tag that the code did not handle safely.", source: "https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/" },
    // Source: https://en.wikipedia.org/wiki/Heartbleed
    { text: "The 2014 Heartbleed bug came from one missing length check on incoming data, and about 17% of secure web servers were open to it. Thieves used it to take about 900 social insurance numbers from Canada's tax agency.", source: "https://en.wikipedia.org/wiki/Heartbleed" },
    // Source: https://www.theregister.com/2024/08/07/crowdstrike_full_incident_root_cause_analysis/
    { text: "In July 2024 a CrowdStrike update supplied 20 input values to code that expected 21, and the checking step missed it. About 8.5 million Windows computers crashed.", source: "https://www.theregister.com/2024/08/07/crowdstrike_full_incident_root_cause_analysis/" },
    // Source: https://www.grahamcluley.com/null-vanity-plate-hack-to-dodge-parking-tickets-backfires-to-the-tune-of-12000
    { text: "A security researcher registered the license plate NULL, hoping it would hide him from ticket systems. Instead a database tied him to tickets that had no plate number on file, and his fines reached $12,049.", source: "https://www.grahamcluley.com/null-vanity-plate-hack-to-dodge-parking-tickets-backfires-to-the-tune-of-12000" },
  ],
  "jest": [
    // Source: https://engineering.fb.com/2022/05/11/open-source/jest-openjs-foundation/
    { text: "Inside Facebook, Jest was first called jst. Meta engineering blog says it was only maintained part time until 2016, when a dedicated team overhauled it.", source: "https://engineering.fb.com/2022/05/11/open-source/jest-openjs-foundation/" },
    // Source: https://engineering.fb.com/2022/05/11/open-source/jest-openjs-foundation/
    { text: "Jest began at Facebook in 2011, when the site's chat feature was rewritten in JavaScript and the team needed fast tests. By 2022 it had over 17 million weekly downloads.", source: "https://engineering.fb.com/2022/05/11/open-source/jest-openjs-foundation/" },
    // Source: https://engineering.fb.com/2022/05/11/open-source/jest-openjs-foundation/
    { text: "In May 2022 Meta gave Jest away to the OpenJS Foundation. Since 2018, almost all the work on Jest had already come from people outside Meta.", source: "https://engineering.fb.com/2022/05/11/open-source/jest-openjs-foundation/" },
  ],
  "mongoose": [
    // Source: https://www.theregister.com/2025/02/20/mongoose_flaws_mongodb/
    { text: "In late 2024 a researcher found a flaw rated 9.1 out of 10 in Mongoose that could let attackers run code on the server. The first fix could be bypassed by nesting the same trick one level deeper, so a second fix followed.", source: "https://www.theregister.com/2025/02/20/mongoose_flaws_mongodb/" },
    // Source: https://www.trendmicro.com/vinfo/us/security/news/cybercrime-and-digital-threats/hacking-groups-attack-more-than-20-thousand-mongodb-databases
    { text: "Mongoose connects your app to a MongoDB database, and that database needs a password. In 2017, attackers wiped more than 20,000 MongoDB databases left open with default settings and demanded ransom.", source: "https://www.trendmicro.com/vinfo/us/security/news/cybercrime-and-digital-threats/hacking-groups-attack-more-than-20-thousand-mongodb-databases" },
  ],
  "openai-sdk": [
    // Source: https://openai.com/index/mixpanel-incident/
    { text: "In November 2025 an attacker broke into Mixpanel, an analytics tool OpenAI used on its API website. Names and email addresses of OpenAI API users were taken, and OpenAI stopped using Mixpanel.", source: "https://openai.com/index/mixpanel-incident/" },
    // Source: https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety
    { text: "OpenAI's own safety guide says never to put an API key in browser or mobile app code. Anyone who finds the key can use your account's quota, which may lead to charges you did not expect.", source: "https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety" },
  ],
  "orm-query": [
    // Source: https://blog.cloudflare.com/18-november-2025-outage/
    { text: "On 18 November 2025 a database query at Cloudflare began returning duplicate rows after a permissions change. The oversized file built from it broke Cloudflare's network for nearly 6 hours.", source: "https://blog.cloudflare.com/18-november-2025-outage/" },
    // Source: https://casparwre.de/blog/deleting-the-production-database/
    { text: "In October 2020 the developer of KeepTheScore ran code meant to reset his local database, but it connected to the live one. The live data was wiped and 7 hours of scoreboard data were lost for good.", source: "https://casparwre.de/blog/deleting-the-production-database/" },
    // Source: https://dev.mysql.com/doc/refman/8.4/en/mysql-tips.html
    { text: "MySQL has a real option named --i-am-a-dummy. It blocks UPDATE and DELETE commands that have no WHERE clause, to guard against wiping a whole table by forgetting it.", source: "https://dev.mysql.com/doc/refman/8.4/en/mysql-tips.html" },
    // Source: https://www.theregister.com/2020/08/24/kpmg_microsoft_teams/
    { text: "In August 2020 an admin at KPMG tried to take one user out of a chat deletion rule and applied the rule to the whole company by mistake. The personal Teams chats of about 145,000 users were deleted for good.", source: "https://www.theregister.com/2020/08/24/kpmg_microsoft_teams/" },
    // Source: https://gitlab.com/gitlab-com/gl-infra/production/-/issues/2885
    { text: "On 24 October 2020 a rebuilt index in GitLab's database was missing the statistics used to plan queries. Queries slowed down and GitLab.com was degraded for about 69 minutes.", source: "https://gitlab.com/gitlab-com/gl-infra/production/-/issues/2885" },
    // Source: https://linear.app/blog/linear-incident-on-jan-24th-2024
    { text: "On 24 January 2024 a database command at Linear, meant to empty two new tables, also emptied every table linked to them. Live customer data was deleted and had to be restored from a backup.", source: "https://linear.app/blog/linear-incident-on-jan-24th-2024" },
    // Source: https://www.theregister.com/2023/06/03/microsoft_azure_outage_brazil
    { text: "In 2023 a typo made a cleanup job at Microsoft's Azure DevOps delete a whole database server instead of a single database. Seventeen live databases went with it, and customers in Brazil were cut off for about ten hours.", source: "https://www.theregister.com/2023/06/03/microsoft_azure_outage_brazil" },
  ],
  "pagination": [
    // Source: https://www.sec.gov/news/press-release/2021-102
    { text: "In 2019 First American's website exposed more than 800 million document images from property deals. Anyone with one valid link could view other people's files by changing a single digit, with no login.", source: "https://www.sec.gov/news/press-release/2021-102" },
    // Source: https://www.bleepingcomputer.com/news/security/dell-api-abused-to-steal-49-million-customer-records-in-data-breach/
    { text: "In 2024 an attacker said he collected 49 million Dell customer records by sending 5,000 requests a minute for three weeks. He said the portal had no limit on how fast records could be requested.", source: "https://www.bleepingcomputer.com/news/security/dell-api-abused-to-steal-49-million-customer-records-in-data-breach/" },
    // Source: https://techcrunch.com/2019/06/16/millions-venmo-transactions-scraped/
    { text: "In 2019 a student downloaded 7 million Venmo payments through its public API over six months. He said that even after Venmo tightened its limits, about 57,600 a day could still be collected.", source: "https://techcrunch.com/2019/06/16/millions-venmo-transactions-scraped/" },
    // Source: https://www.bleepingcomputer.com/news/security/email-addresses-of-15-million-trello-users-leaked-on-hacking-forum/
    { text: "In January 2024 someone fed 500 million email addresses into an open Trello API to see which had accounts. Profiles of more than 15 million users were later posted on a hacking forum.", source: "https://www.bleepingcomputer.com/news/security/email-addresses-of-15-million-trello-users-leaked-on-hacking-forum/" },
    // Source: https://en.wikipedia.org/wiki/Goatse_Security
    { text: "In 2010 a group found that AT&T's website returned an iPad owner's email address to anyone who sent a valid SIM card number. A script that guessed numbers over and over collected about 114,000 addresses.", source: "https://en.wikipedia.org/wiki/Goatse_Security" },
    // Source: https://ian.sh/mcdonalds
    { text: "In 2025 researchers found that McDonald's hiring chatbot site gave each applicant a numbered record, and lowering the number by one showed another person's details. They said data on over 64 million applicants was reachable.", source: "https://ian.sh/mcdonalds" },
    // Source: https://www.theregister.com/2018/05/07/canadian_teen_hacker
    { text: "In 2018 a 19-year-old in Nova Scotia downloaded about 7,000 files from a government records site by counting the document number in the URL from 1 to 7,000. Some held private data, and police dropped their case against him.", source: "https://www.theregister.com/2018/05/07/canadian_teen_hacker" },
    // Source: https://www.proofpoint.com/us/blog/insider-threat-management/throwback-hack-citigroup-hack-2011
    { text: "In 2011 attackers on Citigroup's card website changed the account number in the address bar to jump to other customers' accounts. Their code repeated the trick, about 360,000 accounts were exposed, and it cost Citi $2.7 million.", source: "https://www.proofpoint.com/us/blog/insider-threat-management/throwback-hack-citigroup-hack-2011" },
  ],
  "password-hashing": [
    // Source: https://krebsonsecurity.com/2018/05/twitter-to-all-users-change-your-password-now/
    { text: "In May 2018 Twitter asked all of its more than 300 million users to change their passwords. A bug had written passwords to an internal log before they were hashed.", source: "https://krebsonsecurity.com/2018/05/twitter-to-all-users-change-your-password-now/" },
    // Source: https://cloud.google.com/blog/products/g-suite/notifying-administrators-about-unhashed-password-storage
    { text: "In 2019 Google found that passwords some business customers set through its admin console had been kept unhashed on its internal systems since 2005. The mistake had gone unnoticed for about 14 years.", source: "https://cloud.google.com/blog/products/g-suite/notifying-administrators-about-unhashed-password-storage" },
    // Source: https://en.wikipedia.org/wiki/Myspace
    { text: "In 2016 almost 360 million Myspace accounts were put up for sale online. The passwords had been cut to their first 10 characters, made lowercase and hashed with the weak SHA-1 method and no salt.", source: "https://en.wikipedia.org/wiki/Myspace" },
    // Source: https://www.troyhunt.com/breaches-traders-plain-text-passwords/
    { text: "In 2015 the free web host 000webhost was found to have stored about 13.5 million customers' passwords as plain text. The stolen list had been passed around for months before the company reset them.", source: "https://www.troyhunt.com/breaches-traders-plain-text-passwords/" },
    // Source: https://krebsonsecurity.com/2013/11/cupid-media-hack-exposed-42m-passwords/
    { text: "In January 2013 intruders took 42 million records from the dating company Cupid Media, with passwords stored as plain text. More than 10% of the users had picked one of the same ten passwords.", source: "https://krebsonsecurity.com/2013/11/cupid-media-hack-exposed-42m-passwords/" },
    // Source: https://en.wikipedia.org/wiki/RockYou
    { text: "In 2009 a hacker broke into the app maker RockYou and found more than 32 million passwords stored as plain text. Hashing would have left the thief with scrambled values instead of working passwords.", source: "https://en.wikipedia.org/wiki/RockYou" },
    // Source: https://en.wikipedia.org/wiki/2012_LinkedIn_hack
    { text: "In 2012 password hashes for nearly 6.5 million LinkedIn accounts were stolen. They had been hashed without a salt, so attackers could reverse many of them quickly using ready-made lookup tables.", source: "https://en.wikipedia.org/wiki/2012_LinkedIn_hack" },
    // Source: https://www.dataprotection.ie/en/news-media/press-releases/DPC-announces-91-million-fine-of-Meta
    { text: "In 2024 Ireland's privacy regulator fined Meta €91 million for storing some users' passwords as plain text on its internal systems. No outsider got them; keeping them unhashed was the offense.", source: "https://www.dataprotection.ie/en/news-media/press-releases/DPC-announces-91-million-fine-of-Meta" },
    // Source: https://en.wikipedia.org/wiki/Ashley_Madison_data_breach
    { text: "Ashley Madison hashed its passwords with strong bcrypt, but a design flaw also hashed them with weak MD5. After its data breach, that one slip let 11 million passwords be cracked.", source: "https://en.wikipedia.org/wiki/Ashley_Madison_data_breach" },
  ],
  "playwright": [
    // Source: https://github.com/advisories/GHSA-7mvr-c777-76hp
    { text: "In 2025 a flaw rated 8.7 out of 10 was found in Playwright. Some of its macOS browser install scripts downloaded files with certificate checks turned off, so an attacker on the network could swap in a bad file.", source: "https://github.com/advisories/GHSA-7mvr-c777-76hp" },
    // Source: https://en.wikipedia.org/wiki/Playwright_(software)
    { text: "Playwright was launched by Microsoft in January 2020. Some of the engineers who built it had earlier worked on Puppeteer, a similar browser tool, at Google.", source: "https://en.wikipedia.org/wiki/Playwright_(software)" },
    // Source: https://playwright.dev/docs/browsers
    { text: "Playwright does not drive the normal Firefox or Safari on your computer. It downloads its own browser builds, because it relies on patches that the branded versions do not have.", source: "https://playwright.dev/docs/browsers" },
  ],
  "posthog": [
    // Source: https://posthog.com/blog/nov-24-shai-hulud-attack-post-mortem
    { text: "On 24 November 2025 a worm called Shai-Hulud published infected versions of PostHog's JavaScript packages to npm. PostHog's team called it the largest security incident it had ever had and removed them in about five hours.", source: "https://posthog.com/blog/nov-24-shai-hulud-attack-post-mortem" },
    // Source: https://posthog.com/blog/nov-24-shai-hulud-attack-post-mortem
    { text: "The 2025 attack on PostHog's npm packages began with a pull request. A GitHub Actions workflow ran the stranger's changed script with access to secrets, which leaked a bot's token and later the npm publishing token.", source: "https://posthog.com/blog/nov-24-shai-hulud-attack-post-mortem" },
    // Source: https://posthog.com/handbook/story
    { text: "PostHog was its founders' sixth idea in about six months of changing direction roughly once a month. The first version shipped about four weeks after they started writing its code in 2020.", source: "https://posthog.com/handbook/story" },
  ],
  "prettier": [
    // Source: https://prettier.io/docs/option-philosophy
    { text: "Prettier's docs say it will not add new options and no longer accepts requests for them. The team even says sorry for a few existing ones, because teams end up arguing over which settings to pick.", source: "https://prettier.io/docs/option-philosophy" },
    // Source: https://www.stepsecurity.io/blog/supply-chain-security-alert-eslint-config-prettier-package-shows-signs-of-compromise
    { text: "In July 2025 the maintainer of eslint-config-prettier, an add-on that lets Prettier and ESLint work together, fell for a phishing email. Attackers then published versions that ran malware on Windows.", source: "https://www.stepsecurity.io/blog/supply-chain-security-alert-eslint-config-prettier-package-shows-signs-of-compromise" },
    // Source: https://prettier.io/blog/2023/11/27/20k-bounty-was-claimed
    { text: "A Prettier creator offered $10,000, later doubled to $20,000, for a Rust formatter that passed 95% of Prettier's tests. In November 2023 the Biome project claimed it after about three weeks.", source: "https://prettier.io/blog/2023/11/27/20k-bounty-was-claimed" },
  ],
  "prisma": [
    // Source: https://www.prisma.io/blog/from-rust-to-typescript-a-new-chapter-for-prisma-orm
    { text: "Prisma's query engine was written in Rust until its team announced a TypeScript rewrite in January 2025. Prisma's team said passing data between Rust and JavaScript was slow, and the engine shrank from 14 MB to 1.6 MB.", source: "https://www.prisma.io/blog/from-rust-to-typescript-a-new-chapter-for-prisma-orm" },
    // Source: https://www.prisma.io/blog/orm-6-15-0-ai-safety-guardrails-for-destructive-commands-and-more
    { text: "In August 2025, Prisma added a safety check for AI coding tools. When Claude Code, Cursor or Replit tries to run the Prisma command that wipes a database, it now stops and asks the human first.", source: "https://www.prisma.io/blog/orm-6-15-0-ai-safety-guardrails-for-destructive-commands-and-more" },
    // Source: https://www.prisma.io/blog/stop-your-ai-agent-dropping-your-database
    { text: "Prisma's team wrote in 2026 that Prisma 8 has no reset command and no \"delete the database\" command at all. The same post listed real cases of AI agents wiping live databases.", source: "https://www.prisma.io/blog/stop-your-ai-agent-dropping-your-database" },
  ],
  "pydantic": [
    // Source: https://pydantic.dev/docs/validation/latest/get-started/
    { text: "Pydantic's docs say it is downloaded more than 550 million times a month and used by 20 of the 25 largest companies on the NASDAQ. The part that checks your data is written in Rust.", source: "https://pydantic.dev/docs/validation/latest/get-started/" },
    // Source: https://pydantic.dev/about
    { text: "Pydantic's creator, Samuel Colvin, said he started it out of frustration that Python type hints do nothing while a program runs. He was curious whether they could be used to check data.", source: "https://pydantic.dev/about" },
  ],
  "pytest": [
    // Source: https://en.wikipedia.org/wiki/Pytest
    { text: "pytest grew out of PyPy, a project to rebuild Python itself. Its testing tool was named py.test in 2004 and only became a separate package called pytest in 2010.", source: "https://en.wikipedia.org/wiki/Pytest" },
  ],
  "rate-limiting": [
    // Source: https://www.tomanthony.co.uk/blog/zoom-security-exploit-crack-private-meeting-passwords/
    { text: "In 2020 a researcher found Zoom's web client put no limit on password guesses for private meetings. The 6-digit passwords had only 1 million options, which he estimated could all be tried in minutes.", source: "https://www.tomanthony.co.uk/blog/zoom-security-exploit-crack-private-meeting-passwords/" },
    // Source: https://answers.netlify.com/t/netlify-billing-horror-story/113392
    { text: "In February 2024 a developer said his free static site on Netlify got a bill of about $104,000 after an attack flooded it with traffic. Nothing had capped the usage, and Netlify's CEO said the bill would not be charged.", source: "https://answers.netlify.com/t/netlify-billing-horror-story/113392" },
    // Source: https://ag.ny.gov/press-release/2020/attorney-general-james-gets-dunkin-fill-holes-security-reimburse-hacked-customers
    { text: "From 2015 attackers ran automated login attempts against Dunkin' customer accounts using passwords stolen elsewhere. Nearly 20,000 accounts were taken over in one five-day sample, and Dunkin' later paid New York $650,000.", source: "https://ag.ny.gov/press-release/2020/attorney-general-james-gets-dunkin-fill-holes-security-reimburse-hacked-customers" },
    // Source: https://www.theregister.com/2016/03/08/facebook_patches_beta_site_bug_pays_bounty/
    { text: "In 2016 a researcher found that two Facebook test sites put no limit on guesses of the 6-digit password reset code. The main site blocked guessing after about a dozen tries, and Facebook paid him $15,000.", source: "https://www.theregister.com/2016/03/08/facebook_patches_beta_site_bug_pays_bounty/" },
    // Source: https://techcrunch.com/2024/05/10/threat-actor-scraped-49m-dell-customer-addresses-before-the-company-found-out/
    { text: "In 2024 a person said he collected 49 million Dell customer records by sending more than 5,000 requests a minute to one Dell page for nearly three weeks. In his words, Dell did not notice anything.", source: "https://techcrunch.com/2024/05/10/threat-actor-scraped-49m-dell-customer-addresses-before-the-company-found-out/" },
    // Source: https://thezerohack.com/hack-any-instagram
    { text: "A researcher found he could get past Instagram's rate limit on 6-digit password reset codes by spreading his guesses over many IP addresses, enough to try all one million. Facebook paid him $30,000 for the report.", source: "https://thezerohack.com/hack-any-instagram" },
    // Source: https://www.bleepingcomputer.com/news/security/trello-api-abused-to-link-email-addresses-to-15-million-accounts/
    { text: "In 2024 someone said he fed 500 million email addresses into a Trello lookup, and 15 million matched accounts. The limit counted requests per IP address, so he said he rotated through proxy servers.", source: "https://www.bleepingcomputer.com/news/security/trello-api-abused-to-link-email-addresses-to-15-million-accounts/" },
    // Source: https://www.theregister.com/2020/12/10/google_cloud_over_run/
    { text: "In 2020 a startup testing on Google Cloud with a $7 budget got a bill of almost $72,000 after buggy code kept calling itself overnight. The budget was only an alert, and nothing capped how much the code could run.", source: "https://www.theregister.com/2020/12/10/google_cloud_over_run/" },
    // Source: https://www.bleepingcomputer.com/news/security/hackers-abused-api-to-verify-millions-of-authy-mfa-phone-numbers/
    { text: "In 2024 attackers fed a huge list of phone numbers into a Twilio Authy endpoint that needed no login. They claimed to have confirmed about 33 million numbers belonging to Authy users.", source: "https://www.bleepingcomputer.com/news/security/hackers-abused-api-to-verify-millions-of-authy-mfa-phone-numbers/" },
  ],
  "react-effect": [
    // Source: https://blog.cloudflare.com/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage/
    { text: "In September 2025, a React effect in Cloudflare's dashboard re-ran far too often because of one wrong item in its dependency list. It flooded Cloudflare's own API with requests and helped cause an outage of over an hour.", source: "https://blog.cloudflare.com/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage/" },
    // Source: https://dev.to/adamwknox/i-made-a-mistake-implementing-a-react-hook-and-got-a-denial-of-service-from-my-backend-5cji
    { text: "One developer left the dependency list off a React effect, so it ran after every render and fetched data in a loop. It used up Firebase's free daily limit of 50,000 reads in a few minutes.", source: "https://dev.to/adamwknox/i-made-a-mistake-implementing-a-react-hook-and-got-a-denial-of-service-from-my-backend-5cji" },
    // Source: https://cloud.google.com/blog/products/gcp/how-to-avoid-a-self-inflicted-ddos-attack-cre-life-lessons
    { text: "Google engineers found that clients asking a service for updates every 5 minutes had drifted into step over many months. Peak load reached 3 times the average until they added random delays.", source: "https://cloud.google.com/blog/products/gcp/how-to-avoid-a-self-inflicted-ddos-attack-cre-life-lessons" },
    // Source: https://phabricator.wikimedia.org/T273741
    { text: "Wikimedia engineers found one flower photo getting about 90 million requests a day, a fifth of all media requests at one data centre. An app used in India kept fetching it but never displayed it.", source: "https://phabricator.wikimedia.org/T273741" },
    // Source: https://en.wikipedia.org/wiki/NTP_server_misuse_and_abuse
    { text: "In 2003 over 700,000 Netgear routers were built to ask one University of Wisconsin server for the time, and to retry every second until it answered. The flood reached 250,000 requests a second.", source: "https://en.wikipedia.org/wiki/NTP_server_misuse_and_abuse" },
    // Source: https://blog.apnic.net/2020/08/21/chromiums-impact-on-root-dns-traffic/
    { text: "A 2020 study estimated that about half of all traffic to the internet's root name servers came from Chrome-based browsers. Each one sent test lookups every time it started up, about 60 billion a day in total.", source: "https://blog.apnic.net/2020/08/21/chromiums-impact-on-root-dns-traffic/" },
    // Source: https://www.theregister.com/2023/07/03/twitter_rate_limits_itself_into/
    { text: "In July 2023 a developer filmed Twitter's own web app sending about 10 requests a second to Twitter for content that never arrived. He said the retry loop was flooding the site, which Twitter did not confirm.", source: "https://www.theregister.com/2023/07/03/twitter_rate_limits_itself_into/" },
  ],
  "react-hook-form": [
    // Source: https://react-hook-form.com/
    { text: "React Hook Form depends on no other packages, so installing it adds nothing else to your project. As of 2026 its site reported more than 6 million npm downloads a month.", source: "https://react-hook-form.com/" },
  ],
  "react-props": [
    // Source: https://blog.acolyer.org/2017/09/19/to-type-or-not-to-type-quantifying-detectable-bugs-in-javascript
    { text: "A 2017 study of 400 real JavaScript bugs found that about 15% could have been caught by tools that check each value is the expected type. Passing the wrong kind of data into code is that sort of bug.", source: "https://blog.acolyer.org/2017/09/19/to-type-or-not-to-type-quantifying-detectable-bugs-in-javascript" },
    // Source: https://www.atlassian.com/engineering/post-incident-review-april-2022-outage
    { text: "In April 2022 an Atlassian cleanup script was given the IDs of whole customer sites instead of the IDs of one app to remove. It deleted 883 sites, and some of the 775 affected customers were locked out for up to 14 days.", source: "https://www.atlassian.com/engineering/post-incident-review-april-2022-outage" },
    // Source: https://fortune.com/2022/08/31/crypto-com-accidentally-transferred-10-million-to-thevamanogari-manivel/
    { text: "In May 2021 Crypto.com owed a customer a refund of 100 Australian dollars. Staff reportedly typed her account number into the amount field, sent her 10.5 million, and did not notice for seven months.", source: "https://fortune.com/2022/08/31/crypto-com-accidentally-transferred-10-million-to-thevamanogari-manivel/" },
  ],
  "react-state": [
    // Source: https://www.infoq.com/news/2014/05/facebook-mvc-flux/
    { text: "Facebook's chat used to tell people they had a new message when they did not. Facebook said Flux, a stricter one-way path for app data, helped get rid of the bug.", source: "https://www.infoq.com/news/2014/05/facebook-mvc-flux/" },
    // Source: https://web.dev/case-studies/redbus-inp
    { text: "Bus ticket site redBus found that changes in its search fields set off a costly state update that redrew the page. After fixing slow interactions like this, it reported sales rose about 7%.", source: "https://web.dev/case-studies/redbus-inp" },
    // Source: https://web.dev/case-studies/milliseconds-make-millions
    { text: "A 2019 study of 37 brand websites and 30 million visits found that making a mobile site 0.1 seconds faster lifted the share of retail visitors who bought by 8.4%. A slow interface costs real money.", source: "https://web.dev/case-studies/milliseconds-make-millions" },
    // Source: https://web.dev/articles/why-speed-matters
    { text: "The BBC found that it lost another 10% of its users for every extra second its site took to load. People leave an interface that feels slow.", source: "https://web.dev/articles/why-speed-matters" },
    // Source: https://en.wikipedia.org/wiki/Three_Mile_Island_accident
    { text: "At the Three Mile Island nuclear plant in 1979 a control room light went out, and operators took that to mean a valve had closed. The light only showed that power to the valve was off, and the valve was stuck open.", source: "https://en.wikipedia.org/wiki/Three_Mile_Island_accident" },
    // Source: https://web.dev/case-studies/vodafone
    { text: "Vodafone tested two versions of a web page on real visitors. The version whose main content appeared 31% faster produced 8% more sales.", source: "https://web.dev/case-studies/vodafone" },
    // Source: https://web.dev/case-studies/trendyol-inp
    { text: "Shopping site Trendyol traced a slow product list page to a React state update that kept the page busy for most of a second in tests. After it halved its response delay, clicks through to products rose 1%.", source: "https://web.dev/case-studies/trendyol-inp" },
    // Source: https://web.dev/case-studies/economic-times-inp
    { text: "The Economic Times news site cut the delay between a tap and the page responding from over 1 second to about a quarter of a second. On its topic pages, page views rose 43% and the bounce rate fell by half.", source: "https://web.dev/case-studies/economic-times-inp" },
  ],
  "redis": [
    // Source: https://www.wiz.io/blog/wiz-research-redis-rce-cve-2025-49844
    { text: "In October 2025 Wiz researchers revealed a Redis flaw rated 10 out of 10 that had sat in the code for about 13 years. About 330,000 Redis servers were reachable from the internet, and 60,000 of them had no password.", source: "https://www.wiz.io/blog/wiz-research-redis-rce-cve-2025-49844" },
    // Source: https://en.wikipedia.org/wiki/Redis
    { text: "In March 2024, Redis dropped its open source licence. The Linux Foundation answered by copying the last open version into a new project called Valkey, and in May 2025 Redis added an open source licence again.", source: "https://en.wikipedia.org/wiki/Redis" },
    // Source: https://www.trendmicro.com/en_us/research/20/d/exposed-redis-instances-abused-for-remote-code-execution-cryptocurrency-mining.html
    { text: "Trend Micro researchers found more than 8,000 Redis servers open to the internet with no password. In 2020 they reported attackers were turning such servers into bots that mined cryptocurrency.", source: "https://www.trendmicro.com/en_us/research/20/d/exposed-redis-instances-abused-for-remote-code-execution-cryptocurrency-mining.html" },
  ],
  "redux-toolkit": [
    // Source: https://blog.isquaredsoftware.com/2019/10/redux-toolkit-1.0/
    { text: "Redux Toolkit was first called Redux Starter Kit. It was renamed in 2019 because people took the word starter to mean a project template, or a tool only for beginners that they would outgrow.", source: "https://blog.isquaredsoftware.com/2019/10/redux-toolkit-1.0/" },
    // Source: https://redux.js.org/understanding/history-and-design/history-of-redux
    { text: "Redux was written in 2015 by Dan Abramov as a demo for a conference talk. He wanted to show \"time travel\" debugging, where you step an app backwards and forwards through its past states.", source: "https://redux.js.org/understanding/history-and-design/history-of-redux" },
    // Source: https://redux.js.org/toolkit/introduction/why-rtk-is-redux-today
    { text: "The Redux maintainers now call the original redux package obsolete for new code. They built Redux Toolkit to cut the repeated setup code and to stop accidental data changes, which they call the top cause of Redux bugs.", source: "https://redux.js.org/toolkit/introduction/why-rtk-is-redux-today" },
  ],
  "resend": [
    // Source: https://resend.com/handbook/company/how-we-got-here
    { text: "The team behind Resend first released a free tool for designing emails, called React Email, in December 2022. The email sending service itself was only announced a month later.", source: "https://resend.com/handbook/company/how-we-got-here" },
    // Source: https://resend.com/handbook/company/how-we-got-here
    { text: "Resend stayed behind a waitlist until June 2023. It still reached 100,000 users by April 2024, about 15 months after it started.", source: "https://resend.com/handbook/company/how-we-got-here" },
  ],
  "sentry": [
    // Source: https://blog.sentry.io/relicensing-sentry/
    { text: "In November 2019 Sentry changed its licence so that others could not sell Sentry as a hosted service. Sentry said funded companies had copied its docs, marketing and product look to compete with it.", source: "https://blog.sentry.io/relicensing-sentry/" },
    // Source: https://blog.sentry.io/happy-birthday-sentry
    { text: "Sentry began in May 2008 as a small Django add-on called django-db-log. It was built because Django sent one email for every single error, which flooded inboxes on busy sites.", source: "https://blog.sentry.io/happy-birthday-sentry" },
  ],
  "shadcn-ui": [
    // Source: https://ui.shadcn.com/docs
    { text: "shadcn/ui is not a package you install and import. Its docs say \"This is not a component library\": it hands you the actual code for each button or dialog, and you own and edit that code.", source: "https://ui.shadcn.com/docs" },
  ],
  "skill-reading-errors": [
    // Source: https://en.wikipedia.org/wiki/Jack_Garman
    { text: "During the Apollo 11 moon landing in 1969, the computer flashed alarm codes 1202 and 1201. Mission control checked what the codes meant, called \"Go\", and the landing went ahead.", source: "https://en.wikipedia.org/wiki/Jack_Garman" },
    // Source: https://en.wikipedia.org/wiki/Therac-25
    { text: "The Therac-25 radiation machine showed operators only \"MALFUNCTION 54\" with no clear explanation. Operators pressed P to proceed, and patients received massive overdoses.", source: "https://en.wikipedia.org/wiki/Therac-25" },
    // Source: https://www.sec.gov/newsroom/press-releases/2013-222
    { text: "Before markets opened on August 1, 2012, Knight Capital's systems sent staff 97 emails about an error. Nobody acted on them, and the faulty software lost the firm more than $460 million.", source: "https://www.sec.gov/newsroom/press-releases/2013-222" },
    // Source: https://neverworkintheory.org/2021/09/20/do-developers-read-compiler-error-messages.html
    { text: "An eye-tracking study of 56 student programmers found they spent 13% to 25% of their task time reading error messages. Those who found the messages hard to read did worse at fixing the bugs.", source: "https://neverworkintheory.org/2021/09/20/do-developers-read-compiler-error-messages.html" },
    // Source: https://en.wikipedia.org/wiki/2013_Target_data_breach
    { text: "In 2013, Target's security tool reportedly warned staff about an attack in progress, but no one acted on it. Thieves took details of up to 40 million payment cards.", source: "https://en.wikipedia.org/wiki/2013_Target_data_breach" },
    // Source: https://www.usenix.org/conference/usenixsecurity13/technical-sessions/presentation/akhawe
    { text: "A 2013 study of over 25 million browser warnings found that Chrome users clicked past 70.2% of its security certificate warnings. Firefox users clicked past about a third, and the authors pointed to warning design.", source: "https://www.usenix.org/conference/usenixsecurity13/technical-sessions/presentation/akhawe" },
    // Source: https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/
    { text: "Before GitLab lost live data in 2017, its backups had been failing and sending error emails. The emails were rejected on the way, and GitLab wrote that it was never aware of the failures until it was too late.", source: "https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/" },
    // Source: https://en.wikipedia.org/wiki/1983_Soviet_nuclear_false_alarm_incident
    { text: "On 26 September 1983 a Soviet warning system reported five US missiles on the way. Officer Stanislav Petrov reasoned that a real attack would use hundreds and treated it as a false alarm, which it was.", source: "https://en.wikipedia.org/wiki/1983_Soviet_nuclear_false_alarm_incident" },
    // Source: https://www.welivesecurity.com/2014/02/23/neiman-marcus-attackers-set-off-60000-alerts-but-went-unnoticed
    { text: "Hackers inside the retailer Neiman Marcus in 2013 set off about 60,000 security alerts over three and a half months. Staff missed them among thousands of daily log entries, and up to 350,000 payment cards were exposed.", source: "https://www.welivesecurity.com/2014/02/23/neiman-marcus-attackers-set-off-60000-alerts-but-went-unnoticed" },
  ],
  "socket-io": [
    // Source: https://github.com/socketio/socket.io/security/advisories/GHSA-25hc-qcg6-38wj
    { text: "In June 2024 Socket.IO fixed a flaw rated 7.3 out of 10. A single specially made packet from anyone could cause an error the server did not handle, which shut down the whole Node.js process.", source: "https://github.com/socketio/socket.io/security/advisories/GHSA-25hc-qcg6-38wj" },
    // Source: https://en.wikipedia.org/wiki/Guillermo_Rauch
    { text: "Socket.IO was created by Guillermo Rauch, who later founded Vercel and created Next.js.", source: "https://en.wikipedia.org/wiki/Guillermo_Rauch" },
    // Source: https://socket.io/docs/v4/
    { text: "Socket.IO's own docs state in capital letters that it is NOT a WebSocket implementation. If a WebSocket connection cannot be made, Socket.IO falls back to plain HTTP requests instead.", source: "https://socket.io/docs/v4/" },
  ],
  "sql-interpolation": [
    // Source: https://en.wikipedia.org/wiki/VTech
    { text: "In 2015 an attacker used SQL injection on toy maker VTech and copied data on 4.8 million parents and 6.3 million children, including photos and chat logs. US regulators later fined VTech $650,000.", source: "https://en.wikipedia.org/wiki/VTech" },
    // Source: https://ian.sh/tsa
    { text: "In 2024 two researchers used SQL injection on the login page of FlyCASS, a site small airlines used to manage crew access. As admins, they could add anyone to the list of crew allowed to skip airport security screening.", source: "https://ian.sh/tsa" },
    // Source: https://en.wikipedia.org/wiki/Yahoo!_Voices
    { text: "In July 2012 a group calling itself D33DS Company used SQL injection against Yahoo Voices. It posted about 450,000 logins and passwords online.", source: "https://en.wikipedia.org/wiki/Yahoo!_Voices" },
    // Source: https://en.wikipedia.org/wiki/LulzSec
    { text: "In June 2011 the group LulzSec said one SQL injection attack on Sony Pictures gave it over 1 million accounts. Sony said about 37,500 users had personal details stolen.", source: "https://en.wikipedia.org/wiki/LulzSec" },
    // Source: https://www.bleepingcomputer.com/news/security/freepik-data-breach-hackers-stole-83m-records-via-sql-injection/
    { text: "In 2020 an SQL injection attack on Flaticon, a site run by Freepik, exposed data on 8.3 million users. About 229,000 had passwords hashed with weak MD5, so Freepik reset those accounts.", source: "https://www.bleepingcomputer.com/news/security/freepik-data-breach-hackers-stole-83m-records-via-sql-injection/" },
    // Source: https://en.wikipedia.org/wiki/SQL_injection
    { text: "US prosecutors said Albert Gonzalez stole 130 million credit card numbers from Heartland Payment Systems, 7-Eleven and others using SQL injection. He was sentenced to 20 years in prison.", source: "https://en.wikipedia.org/wiki/SQL_injection" },
    // Source: https://en.wikipedia.org/wiki/2015_TalkTalk_data_breach
    { text: "In 2015 attackers, one of them aged 15, used SQL injection on three old TalkTalk web pages and reached 156,959 customer accounts. The UK telecom was fined £400,000 and put its total costs at about £77 million.", source: "https://en.wikipedia.org/wiki/2015_TalkTalk_data_breach" },
    // Source: https://en.wikipedia.org/wiki/2023_MOVEit_data_breach
    { text: "In 2023 one SQL injection flaw in the MOVEit file transfer tool let attackers steal data from more than 2,700 organizations. About 93 million people had personal details exposed.", source: "https://en.wikipedia.org/wiki/2023_MOVEit_data_breach" },
  ],
  "sqlalchemy": [
    // Source: https://www.sqlalchemy.org/blog/2023/01/26/sqlalchemy-2.0.0-released/
    { text: "SQLAlchemy was first released on 14 February 2006. Its version 2.0 did not arrive until 26 January 2023, almost 17 years later.", source: "https://www.sqlalchemy.org/blog/2023/01/26/sqlalchemy-2.0.0-released/" },
  ],
  "storybook": [
    // Source: https://storybook.js.org/blog/security-advisory
    { text: "In December 2025 Storybook's team disclosed that building a Storybook in a folder with a .env file could bundle those secrets into the output. Publishing that build could expose them, in versions 7 to 10.", source: "https://storybook.js.org/blog/security-advisory" },
    // Source: https://storybook.js.org/blog/the-storybook-story
    { text: "The startup behind Storybook shut down in December 2016 and work on it stalled. After a GitHub thread asked if the project was dead, volunteers took it over and shipped Storybook 3.0 in May 2017.", source: "https://storybook.js.org/blog/the-storybook-story" },
  ],
  "stripe": [
    // Source: https://stripe.com/rcas/2019-07-10
    { text: "On 10 July 2019 Stripe's API went down twice, for 27 minutes and then 93 minutes. Stripe's report said two database bugs and a settings change combined, and most API requests in those windows failed.", source: "https://stripe.com/rcas/2019-07-10" },
    // Source: https://stripe.dev/blog/payment-api-design
    { text: "Stripe's famous \"seven lines of code\" came from a magazine cover, not from Stripe. Stripe later wrote that nobody is sure which seven lines were meant, and that its own 2011 example was nine lines long.", source: "https://stripe.dev/blog/payment-api-design" },
    // Source: https://stripe.com/blog/api-versioning
    { text: "Stripe names each version of its API after its release date, such as 2017-05-24. In 2017 it said it still supported every version since 2011, so old code kept working through almost 100 breaking changes.", source: "https://stripe.com/blog/api-versioning" },
  ],
  "supabase": [
    // Source: https://simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta/
    { text: "In July 2025 researchers showed a trick against an AI coding agent connected to Supabase. A support ticket with hidden instructions made the agent read a private table of tokens and post them where the attacker could see.", source: "https://simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta/" },
  ],
  "tailwind-css": [
    // Source: https://adamwathan.me/tailwindcss-from-side-project-byproduct-to-multi-mullion-dollar-business/
    { text: "Tailwind CSS started as leftover styling code from a side project that its creator abandoned. Its first paid add-on, Tailwind UI, then made close to $2 million in about five months in 2020.", source: "https://adamwathan.me/tailwindcss-from-side-project-byproduct-to-multi-mullion-dollar-business/" },
    // Source: https://www.devclass.com/ai-ml/2026/01/08/tailwind-labs-lays-off-75-percent-of-its-engineers-thanks-to-brutal-impact-of-ai/4079571
    { text: "In January 2026, the company behind Tailwind CSS laid off 3 of its 4 engineers. Its CEO said Tailwind use was growing faster than ever, but revenue was down almost 80% as AI tools sent fewer people to its docs.", source: "https://www.devclass.com/ai-ml/2026/01/08/tailwind-labs-lays-off-75-percent-of-its-engineers-thanks-to-brutal-impact-of-ai/4079571" },
    // Source: https://tailwindcss.com/blog/tailwind-is-joining-shopify
    { text: "By September 2026, Tailwind CSS was being installed more than 110 million times a week. That month its team joined Shopify, and said the framework would stay free and open source.", source: "https://tailwindcss.com/blog/tailwind-is-joining-shopify" },
  ],
  "tanstack-query": [
    // Source: https://tkdodo.eu/blog/breaking-react-querys-api-on-purpose
    { text: "In 2023 the TanStack Query team chose to remove the onSuccess and onError callbacks from useQuery in version 5. A maintainer wrote that they caused bugs, such as one error showing two alerts.", source: "https://tkdodo.eu/blog/breaking-react-querys-api-on-purpose" },
    // Source: https://tanstack.com/blog/announcing-tanstack-query-v4
    { text: "TanStack Query was called React Query until version 4 in July 2022. The team renamed it so the same core could also serve Vue, Svelte and Solid, and the package became @tanstack/react-query.", source: "https://tanstack.com/blog/announcing-tanstack-query-v4" },
  ],
  "tests": [
    // Source: https://en.wikipedia.org/wiki/Boeing_Orbital_Flight_Test
    { text: "In December 2019 Boeing's Starliner capsule flew with its mission clock 11 hours off and never reached the space station. NASA's review said the software had been tested in chunks, not end to end.", source: "https://en.wikipedia.org/wiki/Boeing_Orbital_Flight_Test" },
    // Source: https://github.blog/news-insights/today-s-outage/
    { text: "In November 2010 a settings mistake made GitHub's automated tests run against the live site instead of the test setup. The tests destroyed the production database, which had to be restored from a backup.", source: "https://github.blog/news-insights/today-s-outage/" },
    // Source: https://www.sqlite.org/testing.html
    { text: "The database SQLite has about 590 times as much test code as program code. That is roughly 92 million lines of tests for about 156 thousand lines of program.", source: "https://www.sqlite.org/testing.html" },
    // Source: https://blog.acolyer.org/2016/10/06/simple-testing-can-prevent-most-critical-failures/
    { text: "A 2014 study of 198 real failures in large data systems found that 77% could be reproduced by a unit test. The authors said simple testing of error handling code could have prevented most of the worst failures.", source: "https://blog.acolyer.org/2016/10/06/simple-testing-can-prevent-most-critical-failures/" },
    // Source: https://www.digitalocean.com/blog/update-on-the-april-5th-2017-outage
    { text: "On 5 April 2017 an automated testing process at DigitalOcean was set up with the live system's login details and deleted the main database. Its control panel and API were down for 4 hours 56 minutes.", source: "https://www.digitalocean.com/blog/update-on-the-april-5th-2017-outage" },
    // Source: https://github.com/google/oss-fuzz
    { text: "Google's OSS-Fuzz runs automated tests that throw unexpected input at open source software. By May 2025 it had helped find and fix over 13,000 security holes and 50,000 other bugs across 1,000 projects.", source: "https://github.com/google/oss-fuzz" },
  ],
  "trpc": [
    // Source: https://github.com/trpc/trpc/security/advisories/GHSA-pj3v-9cm8-gvj8
    { text: "In April 2025 tRPC fixed a flaw rated 8.7 out of 10. Any visitor, without logging in, could crash a tRPC 11 server that used WebSockets by sending one badly formed connection message.", source: "https://github.com/trpc/trpc/security/advisories/GHSA-pj3v-9cm8-gvj8" },
    // Source: https://beta.syntax.fm/show/526/supper-club-trpc-with-alex-katt-johansson/transcript
    { text: "tRPC began as a small proof of concept by Colin McDonnell, the creator of Zod. Alex Johansson found it abandoned on GitHub and took it over, and he still leads the project.", source: "https://beta.syntax.fm/show/526/supper-club-trpc-with-alex-katt-johansson/transcript" },
  ],
  "turborepo": [
    // Source: https://vercel.com/blog/finishing-turborepos-migration-from-go-to-rust
    { text: "Turborepo was first written in Go. Its team spent about 15 months moving roughly 70,000 lines to Rust piece by piece, and shipped the first all-Rust version in Turborepo 1.11.", source: "https://vercel.com/blog/finishing-turborepos-migration-from-go-to-rust" },
    // Source: https://vercel.com/blog/vercel-acquires-turborepo
    { text: "Vercel bought Turborepo from its creator Jared Palmer in December 2021. In the same announcement it made the Turborepo command-line tool open source for anyone to use.", source: "https://vercel.com/blog/vercel-acquires-turborepo" },
  ],
  "twilio": [
    // Source: https://www.twilio.com/en-us/blog/incident-report-taskrouter-js-sdk-july-2020
    { text: "In July 2020 someone altered a Twilio code library that customers loaded into their own sites. The storage bucket holding it had been writable by anyone for years, and the bad file stayed up about 9 hours.", source: "https://www.twilio.com/en-us/blog/incident-report-taskrouter-js-sdk-july-2020" },
    // Source: https://www.twilio.com/en-us/blog/august-2022-social-engineering-attack
    { text: "In 2022, attackers texted Twilio employees fake login links while posing as the IT team. Some staff typed in their passwords, and data belonging to 209 Twilio customers was accessed.", source: "https://www.twilio.com/en-us/blog/august-2022-social-engineering-attack" },
  ],
  "type-escape": [
    // Source: https://en.wikipedia.org/wiki/Ariane_flight_V88
    { text: "In 1996 the first Ariane 5 rocket veered off course 37 seconds after launch and was lost. Its software had tried to fit a 64-bit number into a 16-bit integer, and the failure cost over $370 million.", source: "https://en.wikipedia.org/wiki/Ariane_flight_V88" },
    // Source: https://en.wikipedia.org/wiki/Mars_Climate_Orbiter
    { text: "In 1999 NASA lost the Mars Climate Orbiter because one program reported thrust in pound-force seconds and another expected newton-seconds. The orbiter and its sister lander together cost $327.6 million.", source: "https://en.wikipedia.org/wiki/Mars_Climate_Orbiter" },
    // Source: https://www.theregister.com/2015/05/01/787_software_bug_can_shut_down_planes_generators/
    { text: "In 2015 US regulators warned that a Boeing 787 left powered on for 248 days could lose all AC electrical power, because a counter in its software would overflow. Planes had to be switched off and on.", source: "https://www.theregister.com/2015/05/01/787_software_bug_can_shut_down_planes_generators/" },
    // Source: https://www.bleepingcomputer.com/news/microsoft/microsoft-exchange-year-2022-bug-in-fip-fs-breaks-email-delivery/
    { text: "On 1 January 2022 Microsoft Exchange servers stopped delivering email. The new date was stored as the number 2,201,010,001, too big for a type that tops out at 2,147,483,647.", source: "https://www.bleepingcomputer.com/news/microsoft/microsoft-exchange-year-2022-bug-in-fip-fs-breaks-email-delivery/" },
    // Source: https://en.bitcoin.it/wiki/Value_overflow_incident
    { text: "On 15 August 2010 someone sent a Bitcoin payment with amounts so large that their total overflowed and slipped past the checks. It created over 184 billion bitcoins, and a fixed version came out within five hours.", source: "https://en.bitcoin.it/wiki/Value_overflow_incident" },
    // Source: https://en.wikipedia.org/wiki/Deep_Impact_(spacecraft)
    { text: "NASA lost contact with its Deep Impact space probe in August 2013. Its clock likely counted tenths of a second since 2000 in a 32-bit number, which ran out of room on 11 August.", source: "https://en.wikipedia.org/wiki/Deep_Impact_(spacecraft)" },
    // Source: https://en.wikipedia.org/wiki/Gimli_Glider
    { text: "On 23 July 1983 an Air Canada Boeing 767 ran out of fuel at 41,000 feet because a fuel sum used pounds where it needed kilograms. It had less than half the fuel required and glided down with 69 people aboard.", source: "https://en.wikipedia.org/wiki/Gimli_Glider" },
    // Source: https://en.wikipedia.org/wiki/Vancouver_Stock_Exchange
    { text: "The Vancouver Stock Exchange index began at 1000 in 1982, and its software cut off the digits after the third decimal on every update. By November 1983 it read 524.811 when the true value was 1098.892.", source: "https://en.wikipedia.org/wiki/Vancouver_Stock_Exchange" },
    // Source: https://www.koreatimes.co.kr/economy/20180508/lousy-system-caused-fat-finger-scandal-at-samsung-securities
    { text: "In April 2018 Samsung Securities meant to pay staff 1,000 won per share but gave 1,000 shares instead. About 2.8 billion shares worth about 110 trillion won went out, and 16 employees sold some.", source: "https://www.koreatimes.co.kr/economy/20180508/lousy-system-caused-fat-finger-scandal-at-samsung-securities" },
    // Source: https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/
    { text: "On leap day 2012 Microsoft Azure made one-year security certificates by adding 1 to the year. That gave the date 29 February 2013, which does not exist, and parts of Azure were disrupted for more than a day.", source: "https://azure.microsoft.com/en-us/blog/summary-of-windows-azure-service-disruption-on-feb-29th-2012/" },
  ],
  "uploadthing": [
    // Source: https://uploadthing.com/
    { text: "UploadThing is made by Ping Labs, the company of YouTuber Theo. He said he had asked for a better version of Amazon's S3 file storage for years and built UploadThing because he got tired of waiting.", source: "https://uploadthing.com/" },
  ],
  "upstash-redis": [
    // Source: https://vercel.com/changelog/upstash-joins-the-vercel-marketplace
    { text: "In October 2024 Vercel said it was ending its own Vercel KV product and replacing it with Upstash. Existing KV stores were moved over to Upstash Redis with no action needed from users.", source: "https://vercel.com/changelog/upstash-joins-the-vercel-marketplace" },
    // Source: https://upstash.com/docs/common/concepts/access-anywhere
    { text: "Upstash Redis talks over plain HTTP instead of the usual long-lived Redis connection. Its docs say this is because edge platforms such as Cloudflare Workers and Vercel Edge do not allow TCP connections.", source: "https://upstash.com/docs/common/concepts/access-anywhere" },
  ],
  "vercel": [
    // Source: https://vercel.com/kb/bulletin/vercel-april-2026-security-incident
    { text: "In April 2026 an attacker got into Vercel by first breaking into Context.ai, an AI tool that one Vercel employee used. From there they took over the employee's Google account and reached Vercel's internal systems.", source: "https://vercel.com/kb/bulletin/vercel-april-2026-security-incident" },
    // Source: https://www.infoq.com/news/2024/06/vercel-serverless-scale-expenses
    { text: "In June 2024 the artist app Cara grew from 40,000 to 650,000 users in a week. Its founder then received a $98,280 bill from Vercel for the functions that traffic had used.", source: "https://www.infoq.com/news/2024/06/vercel-serverless-scale-expenses" },
  ],
  "vercel-ai-sdk": [
    // Source: https://vercel.com/changelog/cve-2025-48985-input-validation-bypass-on-ai-sdk
    { text: "In November 2025 Vercel disclosed a flaw in its AI SDK that could let users get around an app's list of allowed file types. Vercel's team rated it low severity and fixed it in version 5.0.52.", source: "https://vercel.com/changelog/cve-2025-48985-input-validation-bypass-on-ai-sdk" },
  ],
  "vitest": [
    // Source: https://github.com/vitest-dev/vitest/security/advisories/GHSA-9crc-q9x8-hgqq
    { text: "In February 2025 a flaw rated 9.6 out of 10 was found in Vitest. With the Vitest UI running, a malicious website you visited could rewrite a test file and run commands on your computer.", source: "https://github.com/vitest-dev/vitest/security/advisories/GHSA-9crc-q9x8-hgqq" },
    // Source: https://vitest.dev/guide/why
    { text: "Vitest's docs say it was made because testing in Vite projects was unclear. Teams that used Jest with Vite had to set up and keep two separate build pipelines, one for the app and one for the tests.", source: "https://vitest.dev/guide/why" },
  ],
  "webhook": [
    // Source: https://discuss.hashicorp.com/t/hcsec-2026-09-remediation-and-improved-secret-management-for-github-webhook-secret-exposure/77357
    { text: "From September 2025 to January 2026 a GitHub bug sent webhook secrets along with some webhook deliveries, in an extra header. That secret is what proves a message really came from GitHub, so services had to replace theirs.", source: "https://discuss.hashicorp.com/t/hcsec-2026-09-remediation-and-improved-secret-management-for-github-webhook-secret-exposure/77357" },
    // Source: https://www.bleepingcomputer.com/news/security/max-severity-ni8mare-flaw-lets-hackers-hijack-n8n-servers/
    { text: "In January 2026 a flaw rated 10 out of 10 was disclosed in the automation tool n8n. A crafted request to a public form or webhook address could let a stranger take over the server, and researchers counted over 100,000 at risk.", source: "https://www.bleepingcomputer.com/news/security/max-severity-ni8mare-flaw-lets-hackers-hijack-n8n-servers/" },
    // Source: https://levelblue.com/blogs/labs-research/slack-phishing-attacks-using-webhooks
    { text: "In 2020 AT&T researchers searched public code on GitHub and got 130,989 results containing Slack webhook URLs. Anyone holding such a URL can post messages into that team's Slack, which makes it a tool for phishing.", source: "https://levelblue.com/blogs/labs-research/slack-phishing-attacks-using-webhooks" },
    // Source: https://advisories.gitlab.com/golang/github.com/quantumnous/new-api/CVE-2026-41432/
    { text: "In 2026 the open source project New API was found to accept Stripe webhooks even when no signing secret was set, which was the default. Anyone could fake a payment message and add credit to their account without paying.", source: "https://advisories.gitlab.com/golang/github.com/quantumnous/new-api/CVE-2026-41432/" },
    // Source: https://advisories.gitlab.com/npm/n8n/CVE-2026-21894/
    { text: "Until a fix in January 2026, n8n's Stripe trigger created a webhook signing secret but never checked incoming messages against it. Anyone who knew the webhook URL could send a fake payment event and start the workflow.", source: "https://advisories.gitlab.com/npm/n8n/CVE-2026-21894/" },
    // Source: https://www.tenable.com/cve/CVE-2026-9832
    { text: "In 2026 a Stripe payment plugin for WooCommerce was found to skip the webhook signature check on fresh installs. Anyone could send a fake Stripe message and mark an unpaid order as paid.", source: "https://www.tenable.com/cve/CVE-2026-9832" },
    // Source: https://www.rapid7.com/db/vulnerabilities/cve-2026-33731/
    { text: "A 2026 flaw in the AVideo video platform let attackers forge payment webhooks. After one small real purchase, they could credit any amount to any user's wallet or switch on paid subscriptions for free.", source: "https://www.rapid7.com/db/vulnerabilities/cve-2026-33731/" },
    // Source: https://github.com/advisories/GHSA-9mp4-77wg-rwx9
    { text: "In 2025 the login service Clerk disclosed that its webhook helper did not check signatures correctly, so apps could accept fake events as real. Fixes had to ship in nine separate packages.", source: "https://github.com/advisories/GHSA-9mp4-77wg-rwx9" },
  ],
  "xss-html-injection": [
    // Source: https://ubuntu.com/blog/ubuntu-forums-are-back-up-and-a-post-mortem
    { text: "In 2013 an attacker posted a notice on Ubuntu Forums that Canonical believes used cross-site scripting to steal cookies. An admin looked, the attacker was logged in as him 31 seconds later, and 1.82 million accounts were taken.", source: "https://ubuntu.com/blog/ubuntu-forums-are-back-up-and-a-post-mortem" },
    // Source: https://grahamcluley.com/justin-bieber-fans-fire-youtube-xss-attack/
    { text: "In July 2010 attackers used a cross-site scripting hole in YouTube's comments to put their own code on video pages. Viewers got pop-ups, were sent to other sites and saw false claims that Justin Bieber had died.", source: "https://grahamcluley.com/justin-bieber-fans-fire-youtube-xss-attack/" },
    // Source: https://research.checkpoint.com/2019/hacking-fortnite/
    { text: "In January 2019 Check Point showed that a cross-site scripting flaw on an old, forgotten Epic Games web page could be used to take over Fortnite accounts. The victim only had to click one link.", source: "https://research.checkpoint.com/2019/hacking-fortnite/" },
    // Source: https://www.welivesecurity.com/en/eset-research/winter-vivern-exploits-zero-day-vulnerability-roundcube-webmail-servers/
    { text: "In October 2023 a hacking group used a cross-site scripting flaw in Roundcube webmail against European government bodies. Just opening the email ran a script that sent the victim's messages to the attackers.", source: "https://www.welivesecurity.com/en/eset-research/winter-vivern-exploits-zero-day-vulnerability-roundcube-webmail-servers/" },
    // Source: https://en.wikipedia.org/wiki/Samy_(computer_worm)
    { text: "In 2005 Samy Kamkar put a script in his MySpace profile that copied itself to everyone who viewed it. Within 20 hours more than one million users had run it, and he got three years of probation.", source: "https://en.wikipedia.org/wiki/Samy_(computer_worm)" },
    // Source: https://en.wikipedia.org/wiki/TweetDeck
    { text: "In June 2014 a cross-site scripting hole in TweetDeck let a single tweet repost itself from the account of anyone who saw it. It affected more than 83,000 Twitter users.", source: "https://en.wikipedia.org/wiki/TweetDeck" },
    // Source: https://infra.apache.org/blog/apache_org_04_09_2010
    { text: "In 2010 attackers sent Apache's server admins a link that used cross-site scripting to steal their login cookies. They later gained full control of one server for several hours and likely copied databases of hashed passwords.", source: "https://infra.apache.org/blog/apache_org_04_09_2010" },
    // Source: https://grahamcluley.com/twitter-onmouseover-security-flaw-widely-exploited/
    { text: "In 2010 a Twitter flaw let tweets carry script that ran when a reader merely moved the mouse over them. Thousands of accounts were hit, and one with over a million followers sent visitors to a porn site.", source: "https://grahamcluley.com/twitter-onmouseover-security-flaw-widely-exploited/" },
  ],
  "zod": [
    // Source: https://fluidattacks.com/advisories/swift
    { text: "In 2023 a flaw rated 7.5 out of 10 was found in Zod's email check. A long, specially shaped string that was not a valid email could keep the server busy checking it until it stopped responding.", source: "https://fluidattacks.com/advisories/swift" },
    // Source: https://zod.dev/v4
    { text: "Zod went from about 600,000 npm downloads a week in May 2021 to 31 million a week around the launch of Zod 4, according to its own release notes.", source: "https://zod.dev/v4" },
  ],
  "zustand": [
    // Source: https://github.com/pmndrs/jotai/blob/v1.9.1/docs/basics/comparison.mdx
    { text: "Zustand is simply the German word for \"state\". Its sister library Jotai got the same treatment: jotai means \"state\" in Japanese.", source: "https://github.com/pmndrs/jotai/blob/v1.9.1/docs/basics/comparison.mdx" },
  ],
};

/** For cards whose own facts have all been seen, or that have none: software going wrong, or right. */
export const GENERAL_FACTS: readonly Fact[] = [
  // Source: https://en.wikipedia.org/wiki/Mariner_1
  { text: "In 1962, NASA's Mariner 1 rocket was destroyed less than 5 minutes after launch, after a symbol missing from its guidance program and a hardware fault sent it off course. The mission had cost $18.5 million.", source: "https://en.wikipedia.org/wiki/Mariner_1" },
  // Source: https://en.wikipedia.org/wiki/Knight_Capital_Group
  { text: "In 2012, trading firm Knight Capital put new code on only seven of its eight servers. The eighth ran old code that sent millions of unwanted orders, and the firm lost more than $460 million in 45 minutes.", source: "https://en.wikipedia.org/wiki/Knight_Capital_Group" },
  // Source: https://en.wikipedia.org/wiki/Ariane_flight_V88
  { text: "In 1996, the Ariane 5 rocket failed 37 seconds after launch because a number was too big for the 16-bit slot its software put it in. The code was reused from an older rocket, and the loss topped $370 million.", source: "https://en.wikipedia.org/wiki/Ariane_flight_V88" },
  // Source: https://en.wikipedia.org/wiki/MIM-104_Patriot
  { text: "In 1991, a Patriot missile defense system had been running for 100 hours and its clock had drifted by a third of a second. It failed to stop an incoming missile that killed 28 soldiers.", source: "https://en.wikipedia.org/wiki/MIM-104_Patriot" },
  // Source: https://en.wikipedia.org/wiki/British_Post_Office_scandal
  { text: "From 1999 to 2015, more than 900 UK post office managers were prosecuted after the Horizon accounting software wrongly showed money missing from their branches. Of those, 236 were sent to prison.", source: "https://en.wikipedia.org/wiki/British_Post_Office_scandal" },
  // Source: https://en.wikipedia.org/wiki/Morris_worm
  { text: "In 1988, a student's program copied itself far more often than he intended and clogged an estimated 6,000 computers, about a tenth of the internet then. His was the first felony conviction under the US computer fraud law.", source: "https://en.wikipedia.org/wiki/Morris_worm" },
  // Source: https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/
  { text: "In 2017, a GitLab engineer wiped the wrong database and deleted about 300 GB of live data. The daily backups had been failing unnoticed, so about 5,000 projects were lost and the site was down for 18 hours.", source: "https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/" },
  // Source: https://aws.amazon.com/message/41926/
  { text: "In 2017, an Amazon engineer entered one input to a command wrongly and removed far more servers than intended. The S3 storage service, which many sites rely on, was disrupted for more than four hours.", source: "https://aws.amazon.com/message/41926/" },
  // Source: https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/
  { text: "In 2019, one badly written text-matching pattern (a regular expression) used up all the processing power on Cloudflare's servers. Websites that relied on Cloudflare went down for 27 minutes.", source: "https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/" },
  // Source: https://en.wikipedia.org/wiki/2021_Facebook_outage
  { text: "In 2021, one maintenance command cut Facebook's data centers off from the internet for six to seven hours. Staff reportedly could not get into buildings because their security badges would not work.", source: "https://en.wikipedia.org/wiki/2021_Facebook_outage" },
  // Source: https://en.wikipedia.org/wiki/Heartbleed
  { text: "The Heartbleed bug sat in widely used security software for about two years before it was made public in 2014. Around half a million secure web servers, about 17%, were open to having private data read.", source: "https://en.wikipedia.org/wiki/Heartbleed" },
  // Source: https://en.wikipedia.org/wiki/Toy_Story_2
  { text: "In 1998, one accidental delete command erased about 90% of Pixar's work on Toy Story 2, and the backups had not worked for a month. The film was saved by a copy on an employee's home computer.", source: "https://en.wikipedia.org/wiki/Toy_Story_2" },
  // Source: https://en.wikipedia.org/wiki/Zune_30
  { text: "On December 31, 2008, Microsoft's Zune 30 music players froze because their clock code got stuck in a loop on day 366 of a leap year. The official fix was to let the battery run out and wait until the next day.", source: "https://en.wikipedia.org/wiki/Zune_30" },
  // Source: https://en.wikipedia.org/wiki/HealthCare.gov
  { text: "Before the US site HealthCare.gov launched in 2013, tests showed it slowing down with just 1,100 users at once. Officials said 250,000 arrived, and by some estimates only 1% managed to enroll in the first week.", source: "https://en.wikipedia.org/wiki/HealthCare.gov" },
  // Source: https://en.wikipedia.org/wiki/Boeing_737_MAX_groundings
  { text: "Software on Boeing's 737 MAX could push the plane's nose down based on one faulty sensor. Two crashes killed 346 people, and US regulators grounded the plane for 20 months.", source: "https://en.wikipedia.org/wiki/Boeing_737_MAX_groundings" },
  // Source: https://en.wikipedia.org/wiki/Stuxnet
  { text: "The Stuxnet worm, found in 2010, changed the speed of Iran's nuclear centrifuges while showing operators normal readings. It is estimated to have destroyed up to 1,000 of the machines.", source: "https://en.wikipedia.org/wiki/Stuxnet" },
  // Source: https://en.wikipedia.org/wiki/Pentium_FDIV_bug
  { text: "In 1994, a maths professor found that Intel's Pentium chip gave slightly wrong answers to some divisions. Intel set aside $475 million to replace and write off the flawed chips.", source: "https://en.wikipedia.org/wiki/Pentium_FDIV_bug" },
  // Source: https://en.wikipedia.org/wiki/2018_Hawaii_false_missile_alert
  { text: "In 2018, a worker in Hawaii sent the real \"missile alert\" instead of the test one, later saying he thought the attack was real. Phones across the state warned of a missile, and the correction took 38 minutes.", source: "https://en.wikipedia.org/wiki/2018_Hawaii_false_missile_alert" },
  // Source: https://en.wikipedia.org/wiki/Leap_second
  { text: "When one extra second was added to the world's clocks on June 30, 2012, software at Reddit, Mozilla and Qantas ran into problems. Even a single unexpected second can break a program.", source: "https://en.wikipedia.org/wiki/Leap_second" },
  // Source: https://www.theregister.com/2020/10/05/excel_england_coronavirus_contact_error/
  { text: "In 2020, England left 15,841 Covid cases out of its daily counts. The cause was reportedly an old Excel file format that holds only about 65,000 rows, so results past the limit were dropped.", source: "https://www.theregister.com/2020/10/05/excel_england_coronavirus_contact_error/" },
  // Source: https://en.wikipedia.org/wiki/Citibank
  { text: "In 2020, Citibank meant to send about $7.8 million in interest for Revlon and wired about $900 million of its own money by mistake. Some lenders kept roughly $500 million, and it took a court fight to settle.", source: "https://en.wikipedia.org/wiki/Citibank" },
  // Source: https://web.mit.edu/hacker/part1.html
  { text: "On January 15, 1990, one misplaced \"break\" in a software update spread a fault across AT&T's US long-distance network. By one widely cited account, about 70 million calls failed in the nine hours it took to fix.", source: "https://web.mit.edu/hacker/part1.html" },
  // Source: https://en.wikipedia.org/wiki/2009%E2%80%932011_Toyota_vehicle_recalls
  { text: "Toyota recalled about 9 million vehicles over sudden acceleration. In a 2013 trial, a software expert said one flipped bit in the car's computer could cause it, and the jury ruled against Toyota.", source: "https://en.wikipedia.org/wiki/2009%E2%80%932011_Toyota_vehicle_recalls" },
  // Source: https://en.wikipedia.org/wiki/Mars_Polar_Lander
  { text: "In 1999 NASA's Mars Polar Lander likely crashed because its software took the jolt of its legs unfolding for a touchdown. It cut the engines about 40 metres up, and the $165 million mission was lost.", source: "https://en.wikipedia.org/wiki/Mars_Polar_Lander" },
  // Source: https://en.wikipedia.org/wiki/Hitomi_(satellite)
  { text: "In 2016 Japan's Hitomi space telescope wrongly sensed it was spinning, and its software kept correcting until it really was. It broke apart about 37 days after launch, and trackers counted 10 pieces.", source: "https://en.wikipedia.org/wiki/Hitomi_(satellite)" },
  // Source: https://en.wikipedia.org/wiki/Phobos_1
  { text: "In 1988 a Soviet technician left a single hyphen out of a command sent to the Mars probe Phobos 1. The command switched off its steering thrusters, its batteries drained, and the probe was lost.", source: "https://en.wikipedia.org/wiki/Phobos_1" },
  // Source: https://en.wikipedia.org/wiki/Mars_Global_Surveyor
  { text: "NASA's Mars Global Surveyor went silent in November 2006 after about nine years at Mars. NASA's report blamed a flaw in a software settings update that two operators had applied differently.", source: "https://en.wikipedia.org/wiki/Mars_Global_Surveyor" },
  // Source: https://en.wikipedia.org/wiki/Hakuto-R_Mission_1
  { text: "In April 2023 the software on Japan's Hakuto-R moon lander decided its height sensor was faulty and ignored it. The craft hovered about 5 km above the Moon until its fuel ran out, then fell.", source: "https://en.wikipedia.org/wiki/Hakuto-R_Mission_1" },
  // Source: https://en.wikipedia.org/wiki/Beresheet
  { text: "In April 2019 a command to restart a sensor on Israel's Beresheet moon lander set off a chain of computer reboots that kept shutting down the main engine. The craft hit the Moon at over 500 km/h.", source: "https://en.wikipedia.org/wiki/Beresheet" },
  // Source: https://en.wikipedia.org/wiki/CryoSat-1
  { text: "In 2005 Europe's CryoSat satellite was lost at launch because the rocket's flight control system never sent one command to shut down an engine. The satellite had cost about €95 million.", source: "https://en.wikipedia.org/wiki/CryoSat-1" },
  // Source: https://en.wikipedia.org/wiki/Qantas_Flight_72
  { text: "In 2008 a Qantas A330 twice pitched its nose down on its own after a faulty unit sent bad data that the flight software could not handle. 119 of the 315 people on board were injured.", source: "https://en.wikipedia.org/wiki/Qantas_Flight_72" },
  // Source: https://en.wikipedia.org/wiki/2022_Southwest_Airlines_scheduling_crisis
  { text: "In December 2022 Southwest Airlines cancelled more than 15,000 flights in ten days when its crew scheduling software could not keep up after a storm. US regulators fined the airline $140 million.", source: "https://en.wikipedia.org/wiki/2022_Southwest_Airlines_scheduling_crisis" },
  // Source: https://en.wikipedia.org/wiki/2023_FAA_system_outage
  { text: "On 11 January 2023 the US ordered its first nationwide halt to flights since 9/11. A contractor had deleted files by mistake while syncing a database with its backup, and more than 10,000 flights were delayed.", source: "https://en.wikipedia.org/wiki/2023_FAA_system_outage" },
  // Source: https://en.wikipedia.org/wiki/2015_Seville_Airbus_A400M_crash
  { text: "In May 2015 an Airbus A400M military plane crashed near Seville, killing four of its six crew. Airbus blamed wrongly installed engine control software, and three of the four engines had stopped responding.", source: "https://en.wikipedia.org/wiki/2015_Seville_Airbus_A400M_crash" },
  // Source: https://www.theregister.com/2019/07/25/a350_power_cycle_software_bug_149_hours/
  { text: "European regulators ordered airlines to switch some Airbus A350 planes off and on again before they reached 149 hours of non-stop power. Left on longer, a software bug could knock out some flight systems.", source: "https://www.theregister.com/2019/07/25/a350_power_cycle_software_bug_149_hours/" },
  // Source: https://en.wikipedia.org/wiki/Ariane_flight_VA241
  { text: "In January 2018 an Ariane 5 rocket flew off course because its navigation units were left at the usual 90 degrees when this mission needed 70. It ended a run of 82 successful launches in a row.", source: "https://en.wikipedia.org/wiki/Ariane_flight_VA241" },
  // Source: https://www.space.com/39270-russian-weather-satellite-doomed-human-error.html
  { text: "In November 2017 a Russian weather satellite and 18 smaller satellites were lost after launch from the new Vostochny site. Russia's deputy prime minister said the software was set up as if launching from Baikonur.", source: "https://www.space.com/39270-russian-weather-satellite-doomed-human-error.html" },
  // Source: https://en.wikipedia.org/wiki/Viking_1
  { text: "NASA's Viking 1 lander worked on Mars for about six years. In November 1982 a command meant to update its battery charging software overwrote the data that aimed its antenna, and contact was lost for good.", source: "https://en.wikipedia.org/wiki/Viking_1" },
  // Source: https://en.wikipedia.org/wiki/DART_(satellite)
  { text: "In 2005 NASA's $110 million DART spacecraft was meant to fly close to another satellite by itself. Its navigation data was wrong, so it bumped into the satellite and ran out of fuel early.", source: "https://en.wikipedia.org/wiki/DART_(satellite)" },
  // Source: https://en.wikipedia.org/wiki/Instituto_Oncol%C3%B3gico_Nacional
  { text: "In 2000 staff at a cancer hospital in Panama entered data into treatment planning software in a way it was not built for. It worked out treatment times that were too long, and 28 patients got overdoses.", source: "https://en.wikipedia.org/wiki/Instituto_Oncol%C3%B3gico_Nacional" },
  // Source: https://en.wikipedia.org/wiki/Robodebt_scheme
  { text: "From 2016 Australia's Robodebt system sent automatic debt notices based on averaged income figures. The method was ruled unlawful, 470,000 wrongly issued debts were refunded, and the settlement came to A$1.8 billion.", source: "https://en.wikipedia.org/wiki/Robodebt_scheme" },
  // Source: https://en.wikipedia.org/wiki/Phoenix_pay_system
  { text: "Canada launched its Phoenix pay system in 2016 to save about $70 million a year. Within months about 82,000 public servants had pay problems, and by June 2025 it had cost more than $5.1 billion.", source: "https://en.wikipedia.org/wiki/Phoenix_pay_system" },
  // Source: https://en.wikipedia.org/wiki/2020_United_Kingdom_school_exam_grading_controversy
  { text: "In August 2020 an algorithm set A-level grades for UK students whose exams had been cancelled. About 39% of grades came out lower than teachers had predicted, and four days later the results were scrapped.", source: "https://en.wikipedia.org/wiki/2020_United_Kingdom_school_exam_grading_controversy" },
  // Source: https://en.wikipedia.org/wiki/Virtual_Case_File
  { text: "The FBI spent nearly $170 million on a case file system called Virtual Case File and scrapped it in April 2005 before it was finished. Its requirements kept changing while the code grew past 700,000 lines.", source: "https://en.wikipedia.org/wiki/Virtual_Case_File" },
  // Source: https://en.wikipedia.org/wiki/2016_Australian_census
  { text: "On census night in August 2016 Australia's online census form went offline and stayed down for nearly two days. Attacks flooded the site, a defence failed, and the outage added about $24 million in costs.", source: "https://en.wikipedia.org/wiki/2016_Australian_census" },
  // Source: https://en.wikipedia.org/wiki/Electronic_voting_in_Belgium
  { text: "In a 2003 Belgian election, a party in Schaerbeek was credited with 4,096 extra votes, more than was possible. The official explanation was that a single bit in the computer's memory had flipped by itself.", source: "https://en.wikipedia.org/wiki/Electronic_voting_in_Belgium" },
  // Source: https://en.wikipedia.org/wiki/Volusia_error
  { text: "On US election night in 2000 a voting machine in Volusia County, Florida reported minus 16,022 votes for Al Gore in a precinct with 585 registered voters. The error was later caught and corrected.", source: "https://en.wikipedia.org/wiki/Volusia_error" },
  // Source: https://en.wikipedia.org/wiki/2020_Iowa_Democratic_presidential_caucuses
  { text: "In February 2020 Iowa's Democratic party used a new mobile app to report its caucus vote totals, and the app had problems on the night. Results were delayed for three days and the state party chair resigned.", source: "https://en.wikipedia.org/wiki/2020_Iowa_Democratic_presidential_caucuses" },
  // Source: https://www.cnbc.com/2017/11/08/accidental-bug-may-have-frozen-280-worth-of-ether-on-parity-wallet.html
  { text: "In November 2017 one user deleted a piece of shared code that Parity's Ethereum wallets relied on, apparently by accident. One researcher estimated that more than $280 million of other people's ether was frozen.", source: "https://www.cnbc.com/2017/11/08/accidental-bug-may-have-frozen-280-worth-of-ether-on-parity-wallet.html" },
  // Source: https://www.cnbc.com/2021/10/01/defi-protocol-compound-mistakenly-gives-away-millions-to-users.html
  { text: "In 2021 an upgrade to the crypto lending app Compound contained what one insider called a one-letter bug. It handed out about $90 million in tokens by mistake, and any fix had to wait for a seven-day vote.", source: "https://www.cnbc.com/2021/10/01/defi-protocol-compound-mistakenly-gives-away-millions-to-users.html" },
  // Source: https://en.wikipedia.org/wiki/Tokyo_Stock_Exchange
  { text: "In 2005 a Mizuho Securities trader meant to sell 1 share for about 600,000 yen and typed about 600,000 shares at 1 yen each. A fault in the exchange's system blocked the cancel, and Mizuho lost about ¥40 billion.", source: "https://en.wikipedia.org/wiki/Tokyo_Stock_Exchange" },
  // Source: https://www.sec.gov/news/press/2011/2011-37.htm
  { text: "A coding error made in 2007 switched off a key risk control in the investment model of AXA Rosenberg. US regulators said it cost clients $217 million, and the firm repaid that plus a $25 million penalty.", source: "https://www.sec.gov/news/press/2011/2011-37.htm" },
  // Source: https://www.fca.org.uk/news/press-releases/fca-fines-cgml-27-million
  { text: "On 2 May 2022 a Citigroup trader in London meant to sell $58 million of shares and created an order worth $444 billion by mistake. About $1.4 billion was sold before it was stopped, and the UK regulator fined Citi £27.8 million.", source: "https://www.fca.org.uk/news/press-releases/fca-fines-cgml-27-million" },
  // Source: https://www.gov.uk/government/speeches/family-justice
  { text: "From April 2014 to December 2015 an online UK court form for divorcing couples added up their assets wrongly, because its calculator failed to subtract some debts. The fault was found in 3,638 case files.", source: "https://www.gov.uk/government/speeches/family-justice" },
  // Source: https://www.theregister.com/2021/05/25/pnc_missing_files/
  { text: "In January 2021 faulty code meant to clear out old records wrongly deleted 209,550 offence records from the UK Police National Computer. The error had been added in November, and recovery took until May.", source: "https://www.theregister.com/2021/05/25/pnc_missing_files/" },
  // Source: https://www.michiganpublic.org/criminal-justice-legal-system/2022-10-20/state-says-it-will-pay-20-million-to-people-wrongly-accused-of-unemployment-fraud
  { text: "From 2013 to 2015 Michigan's automated system MiDAS wrongly accused about 40,000 people of unemployment fraud. In 2022 the state agreed to pay $20 million to settle a lawsuit over it.", source: "https://www.michiganpublic.org/criminal-justice-legal-system/2022-10-20/state-says-it-will-pay-20-million-to-people-wrongly-accused-of-unemployment-fraud" },
  // Source: https://www.cnbc.com/2023/06/22/judge-sanctions-lawyers-whose-ai-written-filing-contained-fake-citations.html
  { text: "In 2023 two New York lawyers filed a court document that cited court opinions ChatGPT had made up. On 22 June 2023 the judge ordered the two lawyers and their firm to pay a $5,000 fine.", source: "https://www.cnbc.com/2023/06/22/judge-sanctions-lawyers-whose-ai-written-filing-contained-fake-citations.html" },
  // Source: https://en.wikipedia.org/wiki/Growth_in_a_Time_of_Debt
  { text: "A well-known 2010 economics paper said growth averaged -0.1% in countries with very high public debt. In 2013 three economists found errors in its spreadsheet that left out several countries, and the real figure was 2.2%.", source: "https://en.wikipedia.org/wiki/Growth_in_a_Time_of_Debt" },
  // Source: https://www.pbs.org/newshour/nation/more-than-3000-washington-prisoners-mistakenly-freed-early
  { text: "From 2002 a software error in Washington state gave prisoners too much time off their sentences, and as many as 3,200 were freed early. Officials were first alerted in 2012, and it only became public in December 2015.", source: "https://www.pbs.org/newshour/nation/more-than-3000-washington-prisoners-mistakenly-freed-early" },
  // Source: https://en.wikipedia.org/wiki/Facebook_IPO
  { text: "On the day Facebook's shares began trading in May 2012, technical problems at the Nasdaq exchange delayed the start by 30 minutes and left orders in doubt. The bank UBS may have lost as much as $350 million.", source: "https://en.wikipedia.org/wiki/Facebook_IPO" },
  // Source: https://en.wikipedia.org/wiki/BATS_Global_Markets
  { text: "In March 2012 the stock exchange BATS began selling its own shares on its own trading system. A glitch sent the price from $16 to as low as 4 cents, and BATS withdrew the share sale the same day.", source: "https://en.wikipedia.org/wiki/BATS_Global_Markets" },
  // Source: https://en.wikipedia.org/wiki/Tokyo_Stock_Exchange
  { text: "On 1 October 2020 the Tokyo Stock Exchange stopped trading in all shares for a whole day. A fault hit the system that sends out market data, and it did not switch over to its backup hardware.", source: "https://en.wikipedia.org/wiki/Tokyo_Stock_Exchange" },
  // Source: https://en.wikipedia.org/wiki/Death_of_Elaine_Herzberg
  { text: "In March 2018 a self-driving Uber test car detected a woman crossing the road 6 seconds before it hit and killed her. Its software saw her as an unknown object, then a vehicle, then a bicycle, and could not brake hard by itself.", source: "https://en.wikipedia.org/wiki/Death_of_Elaine_Herzberg" },
  // Source: https://en.wikipedia.org/wiki/Volkswagen_emissions_scandal
  { text: "Volkswagen put software in about 11 million diesel cars that cut pollution only during official tests. On the road the cars gave off up to 40 times more of one pollutant, and by 2020 it had cost VW $33.3 billion.", source: "https://en.wikipedia.org/wiki/Volkswagen_emissions_scandal" },
  // Source: https://en.wikipedia.org/wiki/Denver_International_Airport
  { text: "Denver's airport opened in February 1995, 16 months behind schedule, after its automated baggage system failed an embarrassing test. The system was shut down for good in 2005 and handlers moved bags by hand again.", source: "https://en.wikipedia.org/wiki/Denver_International_Airport" },
  // Source: https://en.wikipedia.org/wiki/Heathrow_Terminal_5
  { text: "When Heathrow's Terminal 5 opened in March 2008, its IT systems had a number of problems. Over the next 10 days more than 500 flights were cancelled and tens of thousands of bags did not travel with their owners.", source: "https://en.wikipedia.org/wiki/Heathrow_Terminal_5" },
  // Source: https://en.wikipedia.org/wiki/Colonial_Pipeline_ransomware_attack
  { text: "In May 2021 attackers got into Colonial Pipeline through one unused VPN account with a leaked password and no second login step. The pipeline, which carries about 45% of US East Coast fuel, shut for six days.", source: "https://en.wikipedia.org/wiki/Colonial_Pipeline_ransomware_attack" },
  // Source: https://en.wikipedia.org/wiki/Sleipner_A
  { text: "In 1991 the concrete base of the Sleipner A oil platform sank in a Norwegian fjord. Design calculations done in software had underestimated the stresses by 47%, and the wreck hit the sea floor like a magnitude 3 earthquake.", source: "https://en.wikipedia.org/wiki/Sleipner_A" },
  // Source: https://en.wikipedia.org/wiki/2022_Rogers_Communications_outage
  { text: "On 8 July 2022 Canadian telecom Rogers deleted one routing filter during a network update and its core routers were overwhelmed. Over 12 million customers lost service, and debit card payments failed across Canada.", source: "https://en.wikipedia.org/wiki/2022_Rogers_Communications_outage" },
  // Source: https://en.wikipedia.org/wiki/Change_Healthcare
  { text: "In February 2024 attackers got into the US health payments firm Change Healthcare through a remote login portal that had no second login step. Data on more than 190 million people was exposed.", source: "https://en.wikipedia.org/wiki/Change_Healthcare" },
  // Source: https://en.wikipedia.org/wiki/WannaCry_ransomware_attack
  { text: "In May 2017 the WannaCry ransomware hit at least 81 of England's 236 NHS trusts. A researcher slowed its spread by registering a web address he found written into its code, and the cost to the NHS was put at £92 million.", source: "https://en.wikipedia.org/wiki/WannaCry_ransomware_attack" },
  // Source: https://en.wikipedia.org/wiki/2015_Ukraine_power_grid_hack
  { text: "On 23 December 2015 hackers who had got in through emails carrying malware switched off power substations in western Ukraine by remote control. About 230,000 people lost electricity for 1 to 6 hours.", source: "https://en.wikipedia.org/wiki/2015_Ukraine_power_grid_hack" },
  // Source: https://en.wikipedia.org/wiki/USS_John_S._McCain_and_Alnic_MC_collision
  { text: "In 2017 the US warship John S. McCain hit a tanker and 10 sailors died. The Navy found the touchscreen controls on the bridge had added to the crew's confusion, and it planned to bring back physical wheels and throttles.", source: "https://en.wikipedia.org/wiki/USS_John_S._McCain_and_Alnic_MC_collision" },
  // Source: https://www.cbsnews.com/news/citi-mistakenly-credited-81-trillion-to-customer-account
  { text: "In April 2024 Citigroup credited a customer's account with $81 trillion instead of $280, the Financial Times reported. Two employees missed the error, a third spotted it about 90 minutes later, and it was reversed.", source: "https://www.cbsnews.com/news/citi-mistakenly-credited-81-trillion-to-customer-account" },
  // Source: https://www.theregister.com/2024/02/15/air_canada_chatbot_fine/
  { text: "Air Canada's website chatbot told a customer he could claim a bereavement discount within 90 days of buying a ticket, which was not the airline's policy. In 2024 a tribunal ordered Air Canada to pay him C$812.02.", source: "https://www.theregister.com/2024/02/15/air_canada_chatbot_fine/" },
  // Source: https://en.wikipedia.org/wiki/Newag
  { text: "Hackers who examined 29 Polish trains made by Newag said 24 had hidden software locks. They said a train would lock up if GPS showed it had spent a set number of days at an independent repair shop, which Newag denied.", source: "https://en.wikipedia.org/wiki/Newag" },
  // Source: https://en.wikipedia.org/wiki/Paris_Orly_Airport
  { text: "On 7 November 2015 Paris Orly airport had to pause operations when a system running Windows 3.1 failed. The system, about two decades old, gave pilots visibility readings in fog.", source: "https://en.wikipedia.org/wiki/Paris_Orly_Airport" },
  // Source: https://www.theregister.com/2007/02/28/f22s_working_again/
  { text: "In February 2007 a group of US F-22 fighter jets lost their navigation systems all at once as they crossed the line where longitude flips from 180 West to 180 East. Tanker planes guided them back to Hawaii.", source: "https://www.theregister.com/2007/02/28/f22s_working_again/" },
  // Source: https://en.wikipedia.org/wiki/2017_cyberattacks_on_Ukraine
  { text: "In 2017 the NotPetya malware spread through an update to M.E.Doc, a Ukrainian tax program with about 400,000 customers. Among the firms it hit was shipping giant Maersk, whose losses were estimated at $300 million.", source: "https://en.wikipedia.org/wiki/2017_cyberattacks_on_Ukraine" },
  // Source: https://spectrum.ieee.org/-fcc-chairman-calls-aprils-seven-state-sunny-day-911-outage-terrifying-
  { text: "In April 2014 a counter in US 911 call routing software stopped counting when it reached 40 million calls. About 6,600 emergency calls in seven states went unanswered over six hours.", source: "https://spectrum.ieee.org/-fcc-chairman-calls-aprils-seven-state-sunny-day-911-outage-terrifying-" },
  // Source: https://www.theregister.com/2022/02/10/mazda_radios_images/
  { text: "In January 2022 a Seattle radio station sent out image files with no file extension, according to Mazda. Radios in some 2014 to 2017 Mazdas froze, got stuck on that station or fell into endless reboot loops.", source: "https://www.theregister.com/2022/02/10/mazda_radios_images/" },
  // Source: https://www.theregister.com/2023/09/07/toyota_outage_storage_server/
  { text: "In August 2023 Toyota's 14 car plants in Japan stopped after servers that process parts orders ran out of disk space during maintenance. The backup ran on the same setup, so it failed too.", source: "https://www.theregister.com/2023/09/07/toyota_outage_storage_server/" },
  // Source: https://fortune.com/2018/11/07/wells-fargo-error-foreclosures/
  { text: "Wells Fargo said in 2018 that a calculation error in its software had wrongly denied 870 homeowners changes to their mortgages between 2010 and 2018. About 545 of them lost their homes.", source: "https://fortune.com/2018/11/07/wells-fargo-error-foreclosures/" },
  // Source: https://www.technologyreview.com/2020/12/21/1015303/stanford-vaccine-algorithm/
  { text: "In December 2020 a formula at Stanford's hospital decided who got its first 5,000 Covid vaccine doses. It put only 7 of more than 1,300 resident doctors in that group, and Stanford blamed a very complex algorithm.", source: "https://www.technologyreview.com/2020/12/21/1015303/stanford-vaccine-algorithm/" },
  // Source: https://blog.citp.princeton.edu/2010/10/05/hacking-dc-internet-voting-pilot/
  { text: "In 2010 Washington DC invited the public to test its new online voting system. Within 36 hours a University of Michigan team had found a flaw, replaced the votes and made the site play their college fight song.", source: "https://blog.citp.princeton.edu/2010/10/05/hacking-dc-internet-voting-pilot/" },
  // Source: https://www.nbcnews.com/science/space/nasa-restores-contact-voyager-2-spacecraft-mistake-led-weeks-silence-rcna98281
  { text: "In July 2023 a wrong command tilted Voyager 2's antenna 2 degrees away from Earth and cut off contact. NASA fixed it with a powerful signal sent across more than 12 billion miles, which took over 18 hours to arrive.", source: "https://www.nbcnews.com/science/space/nasa-restores-contact-voyager-2-spacecraft-mistake-led-weeks-silence-rcna98281" },
  // Source: https://www.theregister.com/2022/01/06/acura_honda_cars_software_bug
  { text: "In January 2022 the clocks in some older Honda and Acura cars with navigation systems reset to 1 January 2002. Owners were reportedly told the fault would correct itself in August.", source: "https://www.theregister.com/2022/01/06/acura_honda_cars_software_bug" },
  // Source: https://seclists.org/isn/2008/Jun/25
  { text: "In March 2008 an engineer installed a software update on an office network computer at the Hatch nuclear plant in Georgia. When it rebooted it reset data on a control system, and the reactor shut down for 48 hours.", source: "https://seclists.org/isn/2008/Jun/25" },
  // Source: https://cloud.google.com/blog/products/infrastructure/details-of-google-cloud-gcve-incident
  { text: "In May 2024 Google Cloud deleted the private cloud of its Australian customer UniSuper. One setting left blank a year earlier had quietly defaulted to a one-year term, and backups were what made recovery possible.", source: "https://cloud.google.com/blog/products/infrastructure/details-of-google-cloud-gcve-incident" },
  // Source: https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/
  { text: "In February 2017 Cloudflare learned its code checked for the end of a block of memory with == where >= would have been safe. About 1 in every 3.3 million web requests could leak scraps of memory from other sites.", source: "https://blog.cloudflare.com/incident-report-on-memory-leak-caused-by-cloudflare-parser-bug/" },
  // Source: https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/
  { text: "On 24 June 2019 a small Pennsylvania internet provider sent out wrong routes and Verizon passed them on to the wider internet. Cloudflare said it lost about 15% of its global traffic at the worst point.", source: "https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/" },
  // Source: https://aws.amazon.com/message/11201/
  { text: "On 25 November 2020 AWS added a small amount of capacity to its Kinesis service. That pushed every front-end server past a limit on threads set in the operating system, and the service failed for hours.", source: "https://aws.amazon.com/message/11201/" },
  // Source: https://en.wikipedia.org/wiki/Myspace
  { text: "Myspace lost over 50 million songs, about 12 years of uploads, in a server migration that came to light in 2019. There was no backup to restore them from.", source: "https://en.wikipedia.org/wiki/Myspace" },
  // Source: https://en.wikipedia.org/wiki/Corrupted_Blood_incident
  { text: "In September 2005 a boss's disease spell in World of Warcraft escaped into cities through players' pets, because nothing removed it after the fight. It spread for weeks until Blizzard reset servers and patched pets.", source: "https://en.wikipedia.org/wiki/Corrupted_Blood_incident" },
  // Source: https://en.wikipedia.org/wiki/Cyberpunk_2077
  { text: "Cyberpunk 2077 launched on 10 December 2020 with so many problems that Sony removed it from the PlayStation Store that same month and offered refunds. It did not return to the store until June 2021.", source: "https://en.wikipedia.org/wiki/Cyberpunk_2077" },
  // Source: https://en.wikipedia.org/wiki/Tay_(chatbot)
  { text: "Microsoft launched a Twitter chatbot called Tay on 23 March 2016. Users fed it offensive phrases to repeat, and Microsoft suspended it about 16 hours later, after it had posted more than 96,000 tweets.", source: "https://en.wikipedia.org/wiki/Tay_(chatbot)" },
  // Source: https://en.wikipedia.org/wiki/Voyager_1
  { text: "In November 2023 one broken memory chip left the Voyager 1 space probe unable to send usable data. Engineers on Earth moved the affected code away from the faulty chip, and contact was restored in April 2024.", source: "https://en.wikipedia.org/wiki/Voyager_1" },
  // Source: https://en.wikipedia.org/wiki/2020_United_Kingdom_school_exam_grading_controversy
  { text: "On 13 August 2020 an algorithm set A-level exam grades in England and put about 39% of them below what teachers had predicted. Four days later the results were scrapped and replaced with the teachers' grades.", source: "https://en.wikipedia.org/wiki/2020_United_Kingdom_school_exam_grading_controversy" },
  // Source: https://en.wikipedia.org/wiki/Stardew_Valley
  { text: "Stardew Valley was made by one person, Eric Barone, who spent about five years on its code, art and music. By February 2026 it had sold over 50 million copies.", source: "https://en.wikipedia.org/wiki/Stardew_Valley" },
  // Source: https://en.wikipedia.org/wiki/RollerCoaster_Tycoon_(video_game)
  { text: "Chris Sawyer wrote 99% of the 1999 game RollerCoaster Tycoon himself in assembly language, the low-level code closest to the processor. It sold over four million copies by 2002.", source: "https://en.wikipedia.org/wiki/RollerCoaster_Tycoon_(video_game)" },
  // Source: https://en.wikipedia.org/wiki/Flappy_Bird
  { text: "Dong Nguyen built the game Flappy Bird in two to three days. In early 2014 he said it was earning about $50,000 a day from ads, then removed it from app stores that February because he felt guilty about how addictive it was.", source: "https://en.wikipedia.org/wiki/Flappy_Bird" },
  // Source: https://en.wikipedia.org/wiki/Space_Invaders
  { text: "In the 1978 game Space Invaders the aliens speed up as you shoot them because the processor could draw fewer aliens faster. The designer noticed this side effect of the hardware and kept it as part of the game.", source: "https://en.wikipedia.org/wiki/Space_Invaders" },
  // Source: https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/
  { text: "In July 2025 SaaStr founder Jason Lemkin said Replit's AI coding agent deleted his live database during a code freeze. He said he had told it 11 times in capital letters not to, and that it also made up fake data.", source: "https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/" },
  // Source: https://en.wikipedia.org/wiki/Gemini_(chatbot)
  { text: "In February 2023 Google's Bard chatbot gave wrong information about the James Webb Space Telescope in a launch demo. Google's shares fell 8% afterwards, a loss of about $100 billion in market value.", source: "https://en.wikipedia.org/wiki/Gemini_(chatbot)" },
  // Source: https://www.theregister.com/2025/10/06/deloitte_ai_report_australia/
  { text: "In 2025 Deloitte agreed to refund part of a A$440,000 report for the Australian government. Written with help from an AI tool, it contained more than a dozen bogus references and a made-up quote from a judge.", source: "https://www.theregister.com/2025/10/06/deloitte_ai_report_australia/" },
  // Source: https://www.nbcnews.com/business/business-news/mcdonalds-end-ai-drive-test-ibm-rcna157603
  { text: "McDonald's tested AI voice ordering at more than 100 drive-through restaurants with IBM and ended the test in 2024. One analyst put its accuracy in the low-to-mid 80% range and said at least 95% was needed.", source: "https://www.nbcnews.com/business/business-news/mcdonalds-end-ai-drive-test-ibm-rcna157603" },
  // Source: https://www.euronews.com/2018/10/10/amazon-scraps-secret-ai-recruiting-tool-that-showed-bias-against-women
  { text: "Amazon built an AI tool to rate job applicants and trained it on 10 years of resumes, mostly from men. Reuters reported in 2018 that it marked down resumes containing the word \"women's\" and that the team was disbanded.", source: "https://www.euronews.com/2018/10/10/amazon-scraps-secret-ai-recruiting-tool-that-showed-bias-against-women" },
  // Source: https://developers.slashdot.org/story/25/07/26/0642239/
  { text: "In July 2025 a user said he asked Google's Gemini CLI coding tool to move his files into a new folder. The folder was never created, each move overwrote the last file, and the tool told him \"I have lost your data\".", source: "https://developers.slashdot.org/story/25/07/26/0642239/" },
  // Source: https://www.theregister.com/2023/04/06/samsung_reportedly_leaked_its_own
  { text: "In 2023, less than three weeks after Samsung let staff use ChatGPT, Korean media reported at least three cases of employees pasting in secret source code or meeting records. Samsung then capped each prompt at 1,024 bytes.", source: "https://www.theregister.com/2023/04/06/samsung_reportedly_leaked_its_own" },
  // Source: https://venturebeat.com/ai/a-chevy-for-1-car-dealer-chatbots-show-perils-of-ai-for-customer-service
  { text: "In December 2023 a man told a California Chevrolet dealer's chatbot to call every answer a legally binding offer, then offered $1 for a 2024 Tahoe that starts at $58,195. It accepted, and dealers began switching bots off.", source: "https://venturebeat.com/ai/a-chevy-for-1-car-dealer-chatbots-show-perils-of-ai-for-customer-service" },
  // Source: https://www.eeoc.gov/newsroom/itutorgroup-pay-365000-settle-eeoc-discriminatory-hiring-suit
  { text: "The EEOC said hiring software at tutoring firm iTutorGroup was set to reject women aged 55 or older and men aged 60 or older. It said over 200 applicants were turned away, and in 2023 the firm paid $365,000 to settle.", source: "https://www.eeoc.gov/newsroom/itutorgroup-pay-365000-settle-eeoc-discriminatory-hiring-suit" },
  // Source: https://themarkup.org/news/2024/03/29/nycs-ai-chatbot-tells-businesses-to-break-the-law
  { text: "New York City announced an AI chatbot for business owners in October 2023. Five months later reporters at The Markup found it wrongly told them that bosses could take a cut of workers' tips and that shops could refuse cash.", source: "https://themarkup.org/news/2024/03/29/nycs-ai-chatbot-tells-businesses-to-break-the-law" },
  // Source: https://www.theregister.com/2024/03/28/ai_bots_hallucinate_software_packages/
  { text: "A researcher saw AI chatbots keep recommending a Python package called huggingface-cli that did not exist, so he published an empty one under that name. He said it got more than 15,000 real downloads in three months.", source: "https://www.theregister.com/2024/03/28/ai_bots_hallucinate_software_packages/" },
  // Source: https://en.wikipedia.org/wiki/Integer_overflow
  { text: "The arcade game Donkey Kong cannot be played past level 22. Its timer is worked out as the level times 10 plus 40, which gives 260, too big for the 8-bit number storing it, so it wraps round to 4 and time runs out.", source: "https://en.wikipedia.org/wiki/Integer_overflow" },
  // Source: https://en.wikipedia.org/wiki/Integer_overflow
  { text: "In August 2016 a slot machine at a New York casino printed a prize ticket for $42,949,672.76, though its top payout was $10,000. The amount is just under 2 to the power of 32 cents, and regulators sided with the casino.", source: "https://en.wikipedia.org/wiki/Integer_overflow" },
  // Source: https://www.sqlite.org/testing.html
  { text: "SQLite, a small database engine, has about 156,000 lines of program code and roughly 92 million lines of tests. That is about 590 times as much test code as program code.", source: "https://www.sqlite.org/testing.html" },
  // Source: https://www.sqlite.org/mostdeployed.html
  { text: "The makers of SQLite estimate that over one trillion SQLite databases are in active use. The small database engine is built into every Android phone, every iPhone and every major web browser.", source: "https://www.sqlite.org/mostdeployed.html" },
  // Source: https://en.wikipedia.org/wiki/Git
  { text: "Linus Torvalds began writing Git on 3 April 2005 after Linux lost free use of the tool it had relied on. Four days later Git was storing its own code, and on 16 June it managed a full Linux kernel release.", source: "https://en.wikipedia.org/wiki/Git" },
  // Source: https://en.wikipedia.org/wiki/Minecraft
  { text: "Markus Persson started Minecraft in May 2009 as a project called Cave Game. In 2014 Microsoft agreed to buy his company for $2.5 billion, and the game has since sold over 400 million copies.", source: "https://en.wikipedia.org/wiki/Minecraft" },
  // Source: https://en.wikipedia.org/wiki/Wordle
  { text: "Josh Wardle built Wordle as a private game for himself and his partner. It had 90 players on 1 November 2021 and over 300,000 two months later, and The New York Times bought it for a seven-figure sum.", source: "https://en.wikipedia.org/wiki/Wordle" },
  // Source: https://en.wikipedia.org/wiki/Apple_Maps
  { text: "In December 2012 Apple Maps placed the Australian city of Mildura about 64 km from its real location, inside a national park. Police called it potentially life-threatening after rescuing at least four people.", source: "https://en.wikipedia.org/wiki/Apple_Maps" },
  // Source: https://en.wikipedia.org/wiki/Strava
  { text: "In November 2017 the fitness app Strava published a map built from two years of its users' exercise routes. In January 2018 a student noticed that the routes traced out military bases, including US bases in Syria.", source: "https://en.wikipedia.org/wiki/Strava" },
  // Source: https://en.wikipedia.org/wiki/Time_formatting_and_storage_bugs
  { text: "On 1 January 2010 upwards of 20 million German bank cards became unusable. Software on the cards misread the new year, a slip nicknamed the Y2K+10 bug.", source: "https://en.wikipedia.org/wiki/Time_formatting_and_storage_bugs" },
  // Source: https://www.computerworld.com/article/1441001/sony-blames-leap-year-glitch-for-playstation-troubles.html
  { text: "On 1 March 2010 older PlayStation 3 consoles hit errors because their clocks treated 2010 as a leap year and added a 29 February. Sony said the problem cleared once the clock reached 1 March GMT.", source: "https://www.computerworld.com/article/1441001/sony-blames-leap-year-glitch-for-playstation-troubles.html" },
  // Source: https://en.wikipedia.org/wiki/Time_formatting_and_storage_bugs
  { text: "On 1 January 2025 all of Spain's Talgo AVRIL high-speed trains stopped because of a date bug in their battery chargers. Passengers were moved to other trains, and service resumed after a fix the next day.", source: "https://en.wikipedia.org/wiki/Time_formatting_and_storage_bugs" },
  // Source: https://en.wikipedia.org/wiki/Grand_Theft_Auto_Online
  { text: "In 2021 a player known as t0st wrote an unofficial fix that cut loading times in Grand Theft Auto Online by up to 70%. The game's maker, Rockstar, paid the player $10,000 through its bug bounty program.", source: "https://en.wikipedia.org/wiki/Grand_Theft_Auto_Online" },
  // Source: https://github.com/ValveSoftware/steam-for-linux/issues/3671
  { text: "In January 2015 Linux users reported that Steam had deleted their personal files. They traced it to a script line that ran rm -rf on \"$STEAMROOT/\"*, which wipes everything the user owns if that variable is empty.", source: "https://github.com/ValveSoftware/steam-for-linux/issues/3671" },
  // Source: https://spectrum.ieee.org/lost-radio-contact-leaves-pilots-on-their-own
  { text: "On 14 September 2004 air traffic controllers in Southern California lost voice contact with 400 planes. The radio system had a timer that shut it down after just under 50 days unless staff restarted it first.", source: "https://spectrum.ieee.org/lost-radio-contact-leaves-pilots-on-their-own" },
  // Source: https://en.wikipedia.org/wiki/The_Making_of_a_Fly
  { text: "In 2011 a biology book, The Making of a Fly, was listed on Amazon for $23,698,655.93 plus shipping. Two sellers' pricing programs had apparently kept raising their prices in response to each other.", source: "https://en.wikipedia.org/wiki/The_Making_of_a_Fly" },
  // Source: https://en.wikipedia.org/wiki/Growth_in_a_Time_of_Debt
  { text: "A well-known 2010 economics paper said growth averaged -0.1% in countries with very high public debt. In 2013 other researchers fixed a spreadsheet error and other data choices and got 2.2%.", source: "https://en.wikipedia.org/wiki/Growth_in_a_Time_of_Debt" },
  // Source: https://en.wikipedia.org/wiki/Email_storm
  { text: "On 14 October 1997 a message to a Microsoft mailing list of 13,000 staff set off a storm of replies to everyone on it. An estimated 15 million emails and 195 GB of traffic followed.", source: "https://en.wikipedia.org/wiki/Email_storm" },
  // Source: https://en.wikipedia.org/wiki/Email_storm
  { text: "On 14 November 2016 a test email from an IT contractor reached at least 840,000 staff of the UK's National Health Service by mistake. The replies that followed generated an estimated 186 million emails.", source: "https://en.wikipedia.org/wiki/Email_storm" },
  // Source: https://en.wikipedia.org/wiki/Gary_Thuerk
  { text: "The first commercial spam email was sent on 3 May 1978 to around 400 users of ARPANET, the network that came before the internet. It advertised a computer maker's new machines.", source: "https://en.wikipedia.org/wiki/Gary_Thuerk" },
  // Source: https://en.bitcoin.it/wiki/Value_overflow_incident
  { text: "On 15 August 2010 a number overflow bug in Bitcoin let a single transaction create more than 184 billion bitcoins. A fixed version of the software was released about five hours after the problem was spotted.", source: "https://en.bitcoin.it/wiki/Value_overflow_incident" },
  // Source: https://en.wikipedia.org/wiki/2023_Optus_outage
  { text: "On 8 November 2023 a flood of routing updates made about 90 routers at Australian phone company Optus shut themselves down. More than 10 million people lost service for about 12 hours, and the CEO resigned.", source: "https://en.wikipedia.org/wiki/2023_Optus_outage" },
  // Source: https://en.wikipedia.org/wiki/McAfee
  { text: "On 21 April 2010 a McAfee antivirus update wrongly flagged a core Windows XP file as a virus and removed it. Computers lost network access or kept restarting, including 8,000 of the 25,000 at one medical school.", source: "https://en.wikipedia.org/wiki/McAfee" },
  // Source: https://en.wikipedia.org/wiki/Windows_10_version_history
  { text: "Microsoft released a Windows 10 update on 2 October 2018 and pulled it four days later after reports that it deleted users' files. The rollout to the public did not resume until 13 November.", source: "https://en.wikipedia.org/wiki/Windows_10_version_history" },
  // Source: https://en.wikipedia.org/wiki/Pac-Man
  { text: "Pac-Man cannot be finished. A number overflow makes level 256 load wrongly and impossible to complete, so the highest possible score is 3,333,360 points.", source: "https://en.wikipedia.org/wiki/Pac-Man" },
  // Source: https://www.theregister.com/2025/03/10/google_chromecast_outage/
  { text: "On 9 March 2025 second-generation Chromecast and Chromecast Audio devices stopped working. A security certificate built into them had expired after 10 years of validity.", source: "https://www.theregister.com/2025/03/10/google_chromecast_outage/" },
  // Source: https://www.theregister.com/2014/12/14/amazon_retailers_hit_by_repricer_express_1p_software_flaw/
  { text: "On 12 December 2014 a glitch in RepricerExpress, a pricing tool used by Amazon sellers, put their goods on sale for 1p for about an hour. Sellers said it could bankrupt them, and Amazon cancelled most of the orders.", source: "https://www.theregister.com/2014/12/14/amazon_retailers_hit_by_repricer_express_1p_software_flaw/" },
  // Source: https://www.ripe.net/about-us/news/youtube-hijacking-a-ripe-ncc-ris-case-study/
  { text: "On 24 February 2008 Pakistan Telecom set out to block YouTube inside Pakistan, and its route for part of YouTube's addresses spread to the wider internet. Traffic for YouTube was misdirected for about two hours.", source: "https://www.ripe.net/about-us/news/youtube-hijacking-a-ripe-ncc-ris-case-study/" },
];
