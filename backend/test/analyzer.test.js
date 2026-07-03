import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAuthorFingerprint,
  analyzeSubmission,
  compareDocuments,
  toSourceDocument,
} from '../src/services/analyzer.js';

test('detects renamed variables with similar logic', () => {
  const first = toSourceDocument({
    projectId: 'a',
    ownerId: 'u',
    filePath: 'a.js',
    language: 'JavaScript',
    sizeBytes: 100,
    sha256: 'a',
    rawText: `function total(items) {
      let sum = 0;
      for (const item of items) {
        if (item.active) sum += item.price;
      }
      return sum;
    }`,
  });

  const second = toSourceDocument({
    projectId: 'b',
    ownerId: 'u',
    filePath: 'b.js',
    language: 'JavaScript',
    sizeBytes: 100,
    sha256: 'b',
    rawText: `function compute(products) {
      let amount = 0;
      for (const product of products) {
        if (product.active) amount += product.price;
      }
      return amount;
    }`,
  });

  const metrics = compareDocuments(first, second);

  assert.ok(metrics.tokenScore > 0.75);
  assert.ok(metrics.combinedScore > 0.6);
});

test('keeps unrelated files below suspicious threshold', () => {
  const first = toSourceDocument({
    projectId: 'a',
    ownerId: 'u',
    filePath: 'a.py',
    language: 'Python',
    sizeBytes: 100,
    sha256: 'a',
    rawText: `def add(a, b):
      return a + b`,
  });

  const second = toSourceDocument({
    projectId: 'b',
    ownerId: 'u',
    filePath: 'b.css',
    language: 'CSS',
    sizeBytes: 100,
    sha256: 'b',
    rawText: `.panel {
      display: grid;
      color: red;
    }`,
  });

  const metrics = compareDocuments(first, second);

  assert.ok(metrics.combinedScore < 0.45);
});

test('waits when no previous submission exists', async () => {
  const first = toSourceDocument({
    projectId: 'submission-a',
    ownerId: 'u',
    filePath: 'index.js',
    language: 'JavaScript',
    sizeBytes: 100,
    sha256: 'first',
    rawText: 'const total = items.reduce((sum, item) => sum + item.price, 0);',
  });

  const analysis = await analyzeSubmission([first], [], {
    sourceSubmission: { id: 'submission-a', title: 'Submission A' },
  });

  assert.equal(analysis.waiting, true);
  assert.equal(analysis.comparisons.length, 0);
  assert.equal(analysis.projectScore, 0);
});

test('compares only against previous different submissions', async () => {
  const source = toSourceDocument({
    projectId: 'submission-b',
    ownerId: 'u',
    filePath: 'cart.js',
    language: 'JavaScript',
    sizeBytes: 100,
    sha256: 'source',
    rawText: `function total(items) {
      let sum = 0;
      for (const item of items) sum += item.price;
      return sum;
    }`,
  });

  const sameSubmissionHelper = toSourceDocument({
    projectId: 'submission-b',
    ownerId: 'u',
    filePath: 'helper.js',
    language: 'JavaScript',
    sizeBytes: 100,
    sha256: 'same',
    rawText: source.rawText,
  });

  const previous = toSourceDocument({
    projectId: 'submission-a',
    projectTitle: 'Submission A',
    ownerId: 'u',
    filePath: 'cart-copy.js',
    language: 'JavaScript',
    sizeBytes: 100,
    sha256: 'previous',
    rawText: source.rawText,
  });

  const analysis = await analyzeSubmission([source], [sameSubmissionHelper, previous], {
    sourceSubmission: { id: 'submission-b', title: 'Submission B' },
  });

  assert.equal(analysis.waiting, false);
  assert.equal(analysis.comparisons.length, 1);
  assert.equal(analysis.comparisons[0].comparedSubmission.id, 'submission-a');
  assert.ok(analysis.comparisons[0].filePairs.every((pair) => pair.comparedProjectId !== 'submission-b'));
});

test('adds highlighted sections for close line-level matches', async () => {
  const source = toSourceDocument({
    projectId: 'submission-b',
    ownerId: 'u',
    filePath: 'OrderController.php',
    language: 'PHP',
    sizeBytes: 100,
    sha256: 'source-highlight',
    rawText: `if ($student && password_verify($password, $student->password)) {
      $_SESSION["student_id"] = $student->id;
      return redirect("/dashboard");
    }`,
  });

  const previous = toSourceDocument({
    projectId: 'submission-a',
    projectTitle: 'Submission A',
    ownerId: 'u',
    filePath: 'LoginController.php',
    language: 'PHP',
    sizeBytes: 100,
    sha256: 'previous-highlight',
    rawText: `if ($account && password_verify($pass, $account->password)) {
      $_SESSION["account_id"] = $account->id;
      return redirect("/home");
    }`,
  });

  const analysis = await analyzeSubmission([source], [previous], {
    sourceSubmission: { id: 'submission-b', title: 'Submission B' },
  });

  assert.ok(analysis.comparisons[0].matchedSections.length > 0);
  assert.equal(analysis.comparisons[0].matchedSections[0].sourceFile, 'OrderController.php');
});

test('adds block highlights for exact copied files without token-heavy lines', async () => {
  const copiedText = `# onehatBomber.py
# setup notes
# this file was copied exactly`;

  const source = toSourceDocument({
    projectId: 'submission-b',
    ownerId: 'u',
    filePath: 'onehatBomber - Copy.py',
    language: 'Python',
    sizeBytes: copiedText.length,
    sha256: 'same-content',
    rawText: copiedText,
  });

  const previous = toSourceDocument({
    projectId: 'submission-a',
    projectTitle: 'Submission A',
    ownerId: 'u',
    filePath: 'onehatBomber.py',
    language: 'Python',
    sizeBytes: copiedText.length,
    sha256: 'same-content',
    rawText: copiedText,
  });

  const analysis = await analyzeSubmission([source], [previous], {
    sourceSubmission: { id: 'submission-b', title: 'Submission B' },
  });

  assert.equal(analysis.comparisons[0].filePairs[0].score, 100);
  assert.ok(analysis.comparisons[0].matchedSections.length > 0);
  assert.equal(analysis.comparisons[0].matchedSections[0].matchType, 'copied_code');
  assert.match(analysis.comparisons[0].matchedSections[0].sourceSnippet, /onehatBomber/);
});

test('keeps project score at 100 when an exact copied file has weaker nearby pairs', async () => {
  const copiedText = `function clonedLogin(user, password) {
    if (user && password_verify(password, user.password)) {
      session.user = user.id;
      return redirect('/dashboard');
    }
  }`;

  const sourceExact = toSourceDocument({
    projectId: 'submission-b',
    ownerId: 'u',
    filePath: 'src/cloned-login.js',
    language: 'JavaScript',
    sizeBytes: copiedText.length,
    sha256: 'copied-login',
    rawText: copiedText,
  });

  const sourceWeak = toSourceDocument({
    projectId: 'submission-b',
    ownerId: 'u',
    filePath: 'src/cart-summary.js',
    language: 'JavaScript',
    sizeBytes: 100,
    sha256: 'source-weak',
    rawText: `function sum(items) {
      let total = 0;
      for (const item of items) {
        total += item.price;
      }
      return total;
    }`,
  });

  const previousExact = toSourceDocument({
    projectId: 'submission-a',
    projectTitle: 'Submission A',
    ownerId: 'u',
    filePath: 'archive/login-copy.js',
    language: 'JavaScript',
    sizeBytes: copiedText.length,
    sha256: 'copied-login',
    rawText: copiedText,
  });

  const previousWeak = toSourceDocument({
    projectId: 'submission-a',
    projectTitle: 'Submission A',
    ownerId: 'u',
    filePath: 'archive/cart-total.js',
    language: 'JavaScript',
    sizeBytes: 100,
    sha256: 'previous-weak',
    rawText: `function total(products) {
      let amount = 0;
      products.forEach((product) => {
        amount += product.price;
      });
      return amount;
    }`,
  });

  const analysis = await analyzeSubmission([sourceExact, sourceWeak], [previousExact, previousWeak], {
    sourceSubmission: { id: 'submission-b', title: 'Submission B' },
  });

  assert.ok(analysis.comparisons[0].filePairs.length > 1);
  assert.equal(analysis.comparisons[0].filePairs[0].score, 100);
  assert.equal(analysis.projectScore, 100);
});

test('builds a low-deviation author fingerprint for consistent student style', () => {
  const studentName = 'James Matthew Dela Torre';
  const previous = withStudent(
    toSourceDocument({
      projectId: 'author-history-a',
      ownerId: 'u',
      filePath: 'cart.js',
      language: 'JavaScript',
      sizeBytes: 300,
      sha256: 'author-history-a',
      rawText: `function calculateTotal(orderItems) {
  const activeItems = orderItems.filter((item) => item.active);
  let grandTotal = 0;
  for (const orderItem of activeItems) {
    grandTotal += orderItem.price;
  }
  return grandTotal;
}`,
    }),
    studentName,
  );

  const source = toSourceDocument({
    projectId: 'author-new-a',
    ownerId: 'u',
    filePath: 'invoice.js',
    language: 'JavaScript',
    sizeBytes: 300,
    sha256: 'author-new-a',
    rawText: `function calculateInvoice(invoiceItems) {
  const activeItems = invoiceItems.filter((item) => item.active);
  let invoiceTotal = 0;
  for (const invoiceItem of activeItems) {
    invoiceTotal += invoiceItem.amount;
  }
  return invoiceTotal;
}`,
  });

  const analysis = analyzeAuthorFingerprint([source], [previous], { studentName });

  assert.equal(analysis.available, true);
  assert.ok(analysis.authorConsistencyScore >= 75);
  assert.equal(analysis.styleDeviation, 'Low Style Deviation');
});

test('raises author style deviation when the same student style changes sharply', () => {
  const studentName = 'James Matthew Dela Torre';
  const previous = withStudent(
    toSourceDocument({
      projectId: 'author-history-b',
      ownerId: 'u',
      filePath: 'grades.py',
      language: 'Python',
      sizeBytes: 400,
      sha256: 'author-history-b',
      rawText: `def compute_grade(student_scores):
    total_score = 0
    for score in student_scores:
        if score > 0:
            total_score = total_score + score
    return total_score`,
    }),
    studentName,
  );

  const source = toSourceDocument({
    projectId: 'author-new-b',
    ownerId: 'u',
    filePath: 'GradeService.java',
    language: 'Java',
    sizeBytes: 500,
    sha256: 'author-new-b',
    rawText: `public class GradeService
{
	public Integer ComputeGrade(List<Integer> StudentScores)
	{
		Integer TotalScore=0;
		try
		{
			for(Integer Score:StudentScores)
			{
				if(Score>0){TotalScore+=Score;}
			}
		}
		catch(Exception Error)
		{
			throw Error;
		}
		return TotalScore;
	}
}`,
  });

  const analysis = analyzeAuthorFingerprint([source], [previous], { studentName });

  assert.equal(analysis.available, true);
  assert.ok(analysis.authorConsistencyScore < 75);
  assert.match(analysis.styleDeviation, /(Moderate|High) Style Deviation/);
  assert.match(analysis.aiAnalysis, /Manual instructor review/i);
});

test('does not build an author fingerprint from another student history', () => {
  const previous = withStudent(
    toSourceDocument({
      projectId: 'author-history-c',
      ownerId: 'u',
      filePath: 'other.js',
      language: 'JavaScript',
      sizeBytes: 200,
      sha256: 'author-history-c',
      rawText: 'function total(items) { return items.length; }',
    }),
    'Different Student',
  );
  const source = toSourceDocument({
    projectId: 'author-new-c',
    ownerId: 'u',
    filePath: 'mine.js',
    language: 'JavaScript',
    sizeBytes: 200,
    sha256: 'author-new-c',
    rawText: 'function total(items) { return items.length; }',
  });

  const analysis = analyzeAuthorFingerprint([source], [previous], {
    studentName: 'James Matthew Dela Torre',
  });

  assert.equal(analysis.available, false);
  assert.equal(analysis.styleDeviation, 'Insufficient History');
});

function withStudent(document, studentName) {
  return {
    ...document,
    studentName,
  };
}
