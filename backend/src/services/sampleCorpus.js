import { toSourceDocument } from './analyzer.js';

const samples = [
  {
    projectId: 'sample-portal',
    projectTitle: 'Previous Student Portal',
    filePath: 'controllers/LoginController.php',
    language: 'PHP',
    rawText: `<?php
function login($email, $pass) {
  $account = findUserByEmail($email);
  if ($account && password_verify($pass, $account->password)) {
    $_SESSION["account_id"] = $account->id;
    return redirect("/home");
  }
  return redirect("/login?error=1");
}
?>`,
  },
  {
    projectId: 'sample-inventory',
    projectTitle: 'Inventory System 2025',
    filePath: 'src/ProductService.java',
    language: 'Java',
    rawText: `public class ProductService {
  public int computeStockValue(List<Product> products) {
    int total = 0;
    for (Product item : products) {
      if (item.isActive()) {
        total += item.getQuantity() * item.getPrice();
      }
    }
    return total;
  }
}`,
  },
  {
    projectId: 'sample-dashboard',
    projectTitle: 'Dashboard JavaScript',
    filePath: 'assets/dashboard.js',
    language: 'JavaScript',
    rawText: `async function loadDashboard(userId) {
  const response = await fetch('/api/users/' + userId + '/stats');
  const stats = await response.json();
  document.querySelector('#total').textContent = stats.total;
  document.querySelector('#flagged').textContent = stats.flagged;
  return stats;
}`,
  },
];

export const sampleCorpus = samples.map((sample) =>
  toSourceDocument({
    ...sample,
    ownerId: 'sample-owner',
    sizeBytes: Buffer.byteLength(sample.rawText),
    sha256: hashText(sample.rawText),
  }),
);

function hashText(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return String(hash);
}
