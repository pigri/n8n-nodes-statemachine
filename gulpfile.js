const fs = require('fs');
const path = require('path');
const { task, src, dest, parallel } = require('gulp');

function copyNodeIcons() {
	const source = path.resolve('nodes', '**', '*.{png,svg}');
	const destination = path.resolve('dist', 'nodes');

	return src(source, { encoding: false }).pipe(dest(destination));
}

function copyCredentialIcons(done) {
	// gulp 5 throws ENOENT when a glob's base directory is missing, and this
	// package has no credentials/ directory. allowEmpty does not cover this;
	// it only applies to globs that match no files.
	if (!fs.existsSync(path.resolve('credentials'))) {
		done();
		return;
	}

	const source = path.resolve('credentials', '**', '*.{png,svg}');
	const destination = path.resolve('dist', 'credentials');

	return src(source, { encoding: false }).pipe(dest(destination));
}

task('build:icons', parallel(copyNodeIcons, copyCredentialIcons));
