# How Miyagi teaches

This is the standard for everything Miyagi shows a learner: cards, lessons,
explanations, questions, feedback and interface text. It applies to text
written by people, by the learner's AI through Miyagi's prompts, and by coding
assistants working on this repository.

The prompts read the short form of this from `vscode/src/standards.ts`. If you
change one, change the other.

## 1. The explanation standard

An explanation is good when the learner could explain it back. Every
explanation follows these rules.

1. **Start from something the learner already knows.** Open with a familiar
   situation or a one-line everyday analogy, then connect it to the new idea.
   Keep one analogy for the whole lesson and reuse it; do not stack analogies.
2. **Use the learner's own project.** Stories, examples and names come from
   what their app does and from their own files. A general example comes only
   after the one from their project.
3. **The learner predicts before being told.** Ask what they think will
   happen, then show what does. A wrong guess still helps.
4. **Explain what they see.** Never show an error, a command's output or a
   line of code without saying in plain words what each important part means.
5. **One idea, one difference.** A comparison shows two things that are the
   same except for the one difference that matters.
6. **No undefined words.** At Junior depth, use everyday words. Any term that
   must be used is defined the first time it appears.
7. **Say the point in one line.** Each section ends with the idea in one
   plain sentence the learner could repeat.
8. **The learner says it back.** Ask them to explain it in their own words.
9. **Lead to the next thing.** End on the question the next section answers.
10. **Concrete before abstract, problem before solution.** Show the problem
    happening before naming the thing that solves it.

## 2. The lesson structure

Every lesson has the same eight sections, in this order. Each answers one
question.

| # | Section | The question it answers |
|---|---|---|
| 1 | The problem | Why does it exist? |
| 2 | The concept | What is it? |
| 3 | How it works | What happens inside? |
| 4 | Architecture | Where does it fit in your project? |
| 5 | Implementation | How is it used here? |
| 6 | Practical considerations | What to watch for |
| 7 | Application | Your turn |
| 8 | Knowledge check | Can you explain it? |

Every section has the same rhythm: **a hook, something the learner does, the
explanation, the point in one line, a bridge to the next section.** What the
learner does varies so the lesson does not feel repetitive: predict an
outcome, read an explained error, compare two cases, tap code lines to see
why each is there, do a small task, explain in their own words.

Section 1 never names the tool or idea being taught. It shows the problem.
Section 2 introduces it as the answer.

Section 7 is a task the learner does without their assistant: a goal, where
to do it, how to know it is done, a hint that stays hidden until asked for,
and two or three "what happens if…" experiments.

Section 8 asks for an explanation in the learner's own words, one scenario
question, and three or four things to remember.

## 3. Depth

The structure never changes. Depth changes what each section says and what the
learner should be able to do afterwards. Experience is not knowledge: depth is
chosen per card, because a senior front-end developer may be new to Docker.

| Depth | The goal | Focus | Afterwards the learner can |
|---|---|---|---|
| Junior | Understand and use it | What it is, why it exists, its parts, how to use it, how to know it works | Build a basic version alone, with help nearby |
| Mid | Integrate and troubleshoot | What happens inside, how it connects to the rest, debugging, speed, alternatives | Design, build, debug and maintain it in a real project |
| Senior | Evaluate and architect | Architecture, limits, scale, security, cost, when an alternative is better, team standards | Make and defend the decision, and guide others |

## 4. Writing

- Plain words and short sentences. Write the way a patient colleague talks.
- Address the learner as "you" and their code as "your app".
- Use active voice. Say what happens, not what "may potentially occur".
- No praise words ("great job"). Say what was right, then what was missed.
- Describe, never grade the person. "Not met yet" is about their projects.
- Tell failures as what actually happens to a user, not as a category.
- Numbers and names over adjectives: "four containers", not "several".

## 5. Questions

- A question tests the idea, not the wording of the lesson.
- Wrong answers are things a learner might really believe.
- The right answer is never the longest choice, and never gives itself away.
- Every question has a one or two sentence explanation of why.
- A question about the learner's own code never goes on the review schedule;
  the idea's own question does.

## 6. Honesty

- Never invent a link, a version detail, a file or a line number. If unsure,
  say so plainly.
- Further reading is named by title and author. Links open a search for that
  title unless the address is known to be right (official documentation).
- Lessons written by the learner's AI are marked as such.
- Only lines that were actually shown may be quoted or pointed at.

## 7. Privacy

- Code sent to a model is scrubbed of secrets first; a line holding a
  credential is withheld, not scrubbed.
- Nothing leaves the learner's machine except to the AI they chose.

## 8. Interface

- The learner goes first: guess, predict or explain before the answer shows.
- One primary action per screen.
- Short screens. Detail opens in place; nothing important is more than one
  tap away.
- Never block the learner's work. Every check can be skipped.
