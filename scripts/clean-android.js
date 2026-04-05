/**
 * Removes Android Gradle/C++ build outputs, then runs `gradlew clean`.
 * Works on Windows and Unix shells.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const androidRoot = path.join(__dirname, '..', 'android');
const toRemove = [
  path.join(androidRoot, 'app', 'build'),
  path.join(androidRoot, 'app', '.cxx'),
  path.join(androidRoot, 'build'),
  path.join(androidRoot, '.gradle'),
];

for (const dir of toRemove) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('[clean-android] removed', path.relative(process.cwd(), dir));
  }
}

const isWin = process.platform === 'win32';
const gradleCmd = isWin ? 'gradlew.bat' : './gradlew';
execSync(`${gradleCmd} clean`, {
  cwd: androidRoot,
  stdio: 'inherit',
  shell: isWin,
});
