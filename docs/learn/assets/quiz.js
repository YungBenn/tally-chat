// Quiz and numeric-exercise components shared by all lessons.
//
// Multiple choice:
//   <div class="quiz" data-answer="2">
//     <p class="q">Question</p>
//     <button class="opt">A</button> <button class="opt">B</button> <button class="opt">C</button>
//     <p class="why">Explanation shown after answering.</p>
//   </div>
//   data-answer is the zero-based index of the correct option.
//
// Numeric:
//   <div class="calc" data-answer="4600" data-tolerance="0.02">
//     <p class="q">Question</p>
//     <details><summary>Hint</summary>...</details>
//   </div>
//   An input, button and feedback line are added automatically. Tolerance is relative.

document.querySelectorAll(".quiz").forEach((quiz) => {
  const answer = Number(quiz.dataset.answer);
  const opts = [...quiz.querySelectorAll("button.opt")];
  opts.forEach((btn, i) => {
    btn.addEventListener("click", () => {
      btn.classList.add(i === answer ? "right" : "wrong");
      opts[answer].classList.add("right");
      opts.forEach((b) => (b.disabled = true));
      quiz.classList.add("done");
    });
  });
});

document.querySelectorAll(".calc").forEach((calc) => {
  const answer = Number(calc.dataset.answer);
  const tol = Number(calc.dataset.tolerance || 0);
  const row = document.createElement("p");
  row.innerHTML = '<input inputmode="decimal" placeholder="your answer"><button type="button">Check</button>';
  const fb = document.createElement("p");
  fb.className = "fb";
  calc.querySelector(".q").after(row, fb);
  const input = row.querySelector("input");
  const check = () => {
    const v = Number(input.value.replace(/[,$\s]/g, ""));
    if (!input.value.trim() || Number.isNaN(v)) return;
    const ok = Math.abs(v - answer) <= Math.abs(answer) * tol;
    fb.className = "fb " + (ok ? "right" : "wrong");
    fb.textContent = ok ? `Correct: ${calc.dataset.display || answer.toLocaleString()}` : "Not quite. Try again, or open the hint.";
  };
  row.querySelector("button").addEventListener("click", check);
  input.addEventListener("keydown", (e) => e.key === "Enter" && check());
});
