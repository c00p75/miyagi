/**
 * "Did you know": one true fact per idea, shown while a card's hook is being
 * written for the learner's project.
 *
 * The teaching standard forbids inventing facts, so this list is short on
 * purpose. An idea is here only when its fact is well documented; the source
 * is noted beside each. An idea with no entry shows the "While you wait"
 * question instead. Do not add a fact you cannot name a source for, and never
 * let a model write these.
 *
 * Each is at most two sentences: what happened, and why it bears on the idea.
 */
export const FACTS: Readonly<Record<string, string>> = {
  // Uber's 2016 breach, disclosed November 2017: credentials found in a private GitHub repository.
  "hardcoded-secret":
    "In 2016, attackers found cloud keys in one of Uber's code repositories and used them to take the data of 57 million riders and drivers. A key in the code is a key for whoever reads the code.",
  // Heartland Payment Systems, 2008: SQL injection, about 130 million card numbers.
  "sql-interpolation":
    "In 2008, attackers used this exact mistake to steal about 130 million card numbers from the payment company Heartland. It was first described publicly in 1998 and still works today.",
  // LinkedIn, June 2012: 6.5 million unsalted SHA-1 password hashes posted online.
  "password-hashing":
    "In 2012, 6.5 million LinkedIn password hashes leaked. They were stored with a fast method and no salt, so most were cracked within days.",
  // JWT "alg: none" flaw, disclosed by Tim McLean in 2015 across several libraries.
  "auth-token":
    "In 2015, several popular login-token libraries were found to accept a token that said it needed no signature. Anyone could write their own token and be let in.",
  // Mars Climate Orbiter, 1999: pound-force seconds sent where newton-seconds were expected.
  "input-validation":
    "In 1999, NASA lost the $125 million Mars Climate Orbiter because one program sent numbers in imperial units and another assumed metric. Nothing checked what came in.",
  // The Twelve-Factor App, published 2011 by Heroku's Adam Wiggins: "store config in the environment".
  "env-vars":
    "Keeping settings in the environment, not in the code, became a standard through \"The Twelve-Factor App\", written at Heroku in 2011. The same code can then run anywhere with different settings.",
  // Same-origin policy: introduced with Netscape Navigator 2, alongside JavaScript.
  cors: "The rule that stops one website reading another's data is almost as old as JavaScript itself: it arrived with Netscape Navigator 2 in the mid-1990s. CORS is the controlled way to relax it.",
  // Missouri DESE, October 2021: teachers' Social Security numbers present in page source, reported by the St. Louis Post-Dispatch.
  "client-server-boundary":
    "In 2021, a journalist found the Social Security numbers of Missouri teachers in the page source of a state website. Anything sent to the browser can be read by whoever opens it.",
  // E. F. Codd, "A Relational Model of Data for Large Shared Data Banks", 1970.
  "db-schema":
    "Tables, rows and columns come from one paper: Edgar Codd proposed the relational model at IBM in 1970. Most databases you will use still follow it.",
  // Roy Fielding's doctoral dissertation, University of California, Irvine, 2000.
  "api-route":
    "The style most web APIs follow, REST, was defined in Roy Fielding's PhD dissertation in 2000. He was also one of the authors of HTTP itself.",
  // React 16.8, released February 2019, introduced Hooks.
  "react-effect":
    "useEffect is younger than it feels: Hooks only arrived in React 16.8, in February 2019. Before that, the same work was spread across three separate class methods.",
  // Ariane 5 flight 501, 4 June 1996: unhandled overflow converting a 64-bit float to a 16-bit integer.
  "error-handling":
    "In 1996, the Ariane 5 rocket broke apart about 40 seconds after launch. A number too large for its slot raised an error that nothing handled.",
  // Common browser limits: about 4 KB per cookie, about 5 MB of localStorage per origin.
  "browser-storage":
    "A cookie holds about 4 kilobytes; localStorage usually allows about 5 megabytes per site. Neither is hidden from the person using the browser, or from any script running on the page.",
  // React: used on Facebook's News Feed in 2011, open-sourced May 2013.
  "react-state":
    "React was built at Facebook for its News Feed in 2011 and released to everyone in 2013. Its central idea has not changed: the screen is a result of the state.",
  // async/await: C# 5.0 in 2012; JavaScript in ECMAScript 2017.
  "async-await":
    "async and await came to JavaScript in 2017. C# had them five years earlier, and the idea of a value that arrives later goes back to the 1970s.",
  // left-pad, March 2016: unpublished from npm, breaking builds of Babel, React and others.
  "dependency-added":
    "In 2016, an 11-line package called left-pad was removed from npm, and builds of thousands of projects, React and Babel among them, stopped working within hours.",
  // RFC 2324, "Hyper Text Coffee Pot Control Protocol", 1 April 1998.
  "http-fetch":
    "HTTP has an official status code 418, \"I'm a teapot\". It began as an April Fools' joke in 1998, and it is a reminder that every response carries a code your code should check.",
  // Knight Capital, 1 August 2012: $440 million lost in about 45 minutes after a faulty release.
  tests:
    "In 2012, the trading firm Knight Capital lost $440 million in 45 minutes after a release left old code running on one of its servers. Nothing had exercised that path before it met real money.",
  // Tony Hoare, "Null References: The Billion Dollar Mistake", QCon London 2009.
  "type-escape":
    "Tony Hoare, who invented the null reference in 1965, later called it his \"billion-dollar mistake\". Type checks exist to catch that kind of error before the program runs, unless they are switched off.",
  // Solomon Hykes, "The future of Linux Containers", PyCon, March 2013.
  "container-image":
    "Docker was first shown to the public in a five-minute talk at a Python conference in March 2013. Within a few years it had changed how most software is shipped.",
  // CSS Grid shipped in Firefox 52, Chrome 57 and Safari 10.1 in March 2017, and Edge 16 that October.
  "css-layout":
    "CSS Grid reached every major browser in 2017. Before grid and flexbox, page layouts were built with tables and floats, tools never designed for the job.",
  // The Samy worm, MySpace, October 2005: over a million friend requests in about 20 hours.
  "xss-html-injection":
    "In 2005, one MySpace user put a script in his profile. It copied itself to everyone who viewed it and added over a million friends in under a day.",
  // 42.zip: a 42-kilobyte archive that expands to about 4.5 petabytes.
  "file-upload":
    "There is a well-known file called 42.zip. It is 42 kilobytes, and unpacks to about 4.5 petabytes. An upload's size on arrival says little about what it becomes.",
  // The term was coined by Jeff Lindsay in 2007.
  webhook:
    "The word \"webhook\" was coined by Jeff Lindsay in 2007, for the idea of one service calling another's URL when something happens. Whoever knows that URL can call it too.",
  // Härder and Reuter, "Principles of Transaction-Oriented Database Recovery", 1983, coined ACID.
  "db-transaction":
    "The promise behind a transaction has had a name since 1983: ACID. Its first letter stands for atomic, meaning all of the changes happen or none of them do.",
  // GitHub, 28 February 2018: a denial-of-service attack peaking at 1.35 terabits per second.
  "rate-limiting":
    "In 2018, GitHub was hit by a flood of traffic peaking at 1.35 terabits per second. Most floods are far smaller: one script in a loop is enough to exhaust an endpoint with no limit.",
  // Attributed to Phil Karlton, Netscape.
  caching:
    "A programmer at Netscape, Phil Karlton, is credited with a line engineers still quote: there are only two hard things in computer science, cache invalidation and naming things.",
  // Harvard Mark II logbook, 9 September 1947: a moth taped to the page, "First actual case of bug being found".
  "skill-reading-errors":
    "In 1947, engineers on the Harvard Mark II computer found a moth stuck in a relay and taped it into the logbook as the \"first actual case of bug being found\". The page is in the Smithsonian.",
};

/**
 * For cards with no fact of their own: ideas the learner's AI found, tools,
 * and the few built-in ideas above without one. These are about software in
 * general, held to the same rule: well documented, source noted, written by a
 * person. One is picked per card, and stays the same for that card.
 */
export const GENERAL_FACTS: readonly string[] = [
  // Brendan Eich, Netscape, May 1995.
  "JavaScript was written in ten days, in May 1995, by one person: Brendan Eich at Netscape. Much of the web still runs on decisions made that week.",
  // info.cern.ch, published 6 August 1991 by Tim Berners-Lee.
  "The first website went live in 1991 at CERN, the physics lab where Tim Berners-Lee worked. It was a page explaining what the web was, and it is still online.",
  // Linus Torvalds began Git in April 2005 after the Linux project lost its previous tool.
  "Git was started in 2005 by Linus Torvalds, the creator of Linux, when his project lost the tool it had been using. He had a working version within days.",
  // Ada Lovelace's notes on the Analytical Engine, published 1843.
  "What is often called the first computer program was published in 1843 by Ada Lovelace, for a machine that was never finished being built.",
  // Guido van Rossum named Python after "Monty Python's Flying Circus".
  "Python is not named after the snake. Its creator, Guido van Rossum, named it after the comedy show Monty Python's Flying Circus.",
  // Kernighan and Ritchie, "The C Programming Language", 1978.
  "The tradition of a first program that prints \"hello, world\" was spread by one book: The C Programming Language, published in 1978.",
  // Ray Tomlinson, ARPANET email, 1971.
  "The @ sign in email addresses was chosen in 1971 by Ray Tomlinson, who sent the first email between two computers. He picked it because it was unlikely to appear in anyone's name.",
  // Margaret Hamilton led the MIT team that wrote Apollo's onboard flight software.
  "The onboard software that landed Apollo 11 on the Moon was written by a team led by Margaret Hamilton, who is credited with making \"software engineering\" a recognised term.",
];
