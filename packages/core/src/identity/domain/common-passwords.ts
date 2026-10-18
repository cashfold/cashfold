/**
 * Stems of widely leaked passwords, lower case, letters only (digits and symbols are stripped before matching, and
 * look-alike substitutions such as `@` for `a` are undone). A password made only of these stems, repeated or combined,
 * is refused. This is a compact list for the offline check; it is not a substitute for choosing a long passphrase.
 */
export const COMMON_PASSWORD_STEMS: readonly string[] = [
  'password', 'passwd', 'passphrase', 'pass', 'qwerty', 'qwertyuiop', 'qwertyui', 'qwertz', 'azerty', 'asdfghjkl', 'asdfgh', 'asdf',
  'zxcvbnm', 'zxcvbn', 'qazwsx', 'qazwsxedc', 'qazwsxedcrfv', 'zaqwsx', 'iloveyou', 'ilovegod', 'letmein', 'welcome', 'admin',
  'administrator', 'root', 'login', 'master', 'masterpassword', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball',
  'basketball', 'soccer', 'hockey', 'superman', 'batman', 'spiderman', 'starwars', 'pokemon', 'naruto', 'whatever', 'freedom',
  'shadow', 'michael', 'jessica', 'jennifer', 'ashley', 'nicole', 'daniel', 'thomas', 'charlie', 'jordan', 'michelle', 'hunter',
  'ranger', 'buster', 'killer', 'trustno', 'changeme', 'secret', 'access', 'hello', 'abc', 'cashfold', 'computer', 'internet',
  'mustang', 'harley', 'ferrari', 'merlin', 'liverpool', 'arsenal', 'chelsea', 'manchester', 'barcelona', 'forever', 'lovely',
  'blink', 'matrix', 'jesus', 'angel', 'cheese', 'hottie', 'tigger', 'summertime', 'testing', 'test', 'guest', 'user', 'demo',
  'default', 'system', 'oracle', 'google', 'facebook', 'twitter', 'youtube', 'amazon', 'apple', 'samsung', 'bitcoin', 'crypto',
  'starwars', 'maverick', 'rockyou', 'pepper', 'ginger', 'cookie', 'chocolate', 'butterfly', 'flower', 'purple', 'orange',
  'banana', 'cowboy', 'diamond', 'silver', 'golden', 'knight', 'wizard', 'samantha', 'andrew', 'joshua', 'matthew', 'anthony',
  'robert', 'william', 'richard', 'joseph', 'justin', 'brandon', 'amanda', 'jasmine', 'hannah', 'elizabeth', 'taylor', 'lauren',
  'iloveu', 'loveme', 'fuckyou', 'fuckoff', 'pussy', 'sexy', 'baby', 'babygirl', 'myspace', 'nothing', 'snoopy', 'tinkerbell',
  'yankees', 'cowboys', 'lakers', 'eagles', 'steelers', 'patriots', 'redskins', 'dolphins', 'raiders', 'packers', 'broncos',
  'mercedes', 'porsche', 'corvette', 'camaro', 'toyota', 'honda', 'ford', 'bmw', 'audi', 'nissan', 'subaru', 'pontiac',
];

/** Digit-only passwords that are well known: sequences, repeats and calendar-style runs. */
export const COMMON_NUMERIC_RUNS: readonly string[] = [
  '1234567890', '0123456789', '9876543210', '123456789', '12345678', '1234567', '123456', '654321', '987654321', '1111111111',
  '2000000000', '1212121212', '123123123', '112233445566', '121212', '696969', '159753', '147258369', '741852963', '0987654321',
];
