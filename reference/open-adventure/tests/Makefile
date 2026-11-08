# Test-suite makefile for open-adventure

# SPDX-FileCopyrightText: Copyright Eric S. Raymond <esr@thyrsus.com>
# SPDX-License-Identifier: BSD-2-Clause

# Use absolute path so tests that change working directory still use
# scripts from parent directory.  Note that using $PWD seems to fail
# here under Gitlab's CI environment.
PARDIR=$(realpath ..)
PATH := $(PARDIR):$(realpath .):${PATH}
GCOV?=gcov

# Make this overrideable so it's easier to test old versions
advent?=advent

# Defeat annoying behavior under Mac OS X - builtin echo doesn't do -n
ECHO := /bin/echo

# The TAP filter. Only affects presentation of the test suite messages
TAPCONSUMER=tapview

# Fall back to safety if our declared TAP consumer does not exist.
# This is helpful in the CI environment, where it would be better for
# the logfiles to carry the raw TAP messages. 
TAPFILTER=$(shell command -v $(TAPCONSUMER) || echo cat)

# Find all *.log entries to test
TESTLOADS := $(shell ls -1 *.log | sed '/.log/s///' | sort)

.PHONY: check clean testlist listcheck savegames savecheck coverage
.PHONY: buildchecks multifile-regress tap count

check: savecheck
	@make tap | tapview
	@-advent -x 2>/dev/null	|| exit 0 # Get usage message into coverage tests

.SUFFIXES: .chk

clean:
	rm -fr *~ *.adv scratch.tmp *.ochk advent430 adventure.data

# Show summary lines for all tests.
testlist:
	@grep '^##' *.log
listcheck:
	@for f in *.log; do \
	    if ( head -3 $$f | grep -q '^ *##' ); then :; else echo "$$f needs a description"; fi; \
	done

# Generate bogus savegames.
cheat_numdie.adv:
	@$(PARDIR)/cheat -d -900 -o cheat_numdie.adv > /tmp/cheat_numdie
cheat_numdie1000.adv:
	@$(PARDIR)/cheat -d -1000 -o cheat_numdie1000.adv > /tmp/cheat_numdie1000
cheat_savetamper.adv:
	@$(PARDIR)/cheat -d 2000 -o cheat_savetamper.adv > /tmp/cheat_savetamper
resume_badversion.adv:
	@$(PARDIR)/cheat -v -1337 -o resume_badversion.adv > /tmp/cheat_badversion
thousand_saves.adv:
	@$(PARDIR)/cheat -s -1000 -o thousand_saves.adv > /tmp/cheat_1000saves
thousand_turns.adv:
	@$(PARDIR)/cheat -t -1000 -o thousand_turns.adv > /tmp/cheat_1000turns
thousand_limit.adv:
	@$(PARDIR)/cheat -l -1000 -o thousand_limit.adv > /tmp/cheat_1000limit
SGAMES = cheat_numdie.adv cheat_numdie1000.adv cheat_savetamper.adv resume_badversion.adv \
	thousand_saves.adv thousand_turns.adv thousand_limit.adv

# Force coverage of cheat edgecases
scheck1:
	@$(PARDIR)/cheat -QqQ 2> /tmp/coverage_cheat_batopt | true
	@./outcheck.sh "cheat: bogus option for save file generation"
scheck2:
	@$(PARDIR)/cheat 2>/dev/null | true
	@./outcheck.sh "cheat: No save file specified"
scheck3:
	@$(PARDIR)/cheat -d 1 2> /tmp/coverage_cheat_nooutput | true
	@./outcheck.sh "cheat: doesn't save because we omit -o"
scheck4:
	@$(PARDIR)/cheat -o / 2> /tmp/coverage_cheat_badoutput | true
	@./outcheck.sh "cheat: doesn't save to invalid path"
scheck5:
	@$(advent) -r /badfilename < pitfall.log > /tmp/coverage_advent_readfail 2>&1 || exit 1
	@./outcheck.sh "cheat: doesn't start with invalid file with -r"
scheck6:
	@$(advent) -l / < pitfall.log > /tmp/coverage_advent_logfail 2>&1 || exit 1
	@./outcheck.sh "cheat: doesn't start with invalid file passed to -l"
scheck7:
	@$(advent) -r thousand_saves.adv < pitfall.log > /tmp/coverage_advent_readfail 2>&1 || exit 1
	@./outcheck.sh "test -r with valid input"
SCHECKS = scheck1 scheck2 scheck3 scheck4 scheck5 scheck6 scheck7

# Don't run this from here, you'll get cryptic warnings and no good result
# if the advent binary wasn't built with coverage flags.  Do "make clean coverage"
# from the top-level directory.
coverage: check
	lcov -t "advent" -o $(PARDIR)/advent.info -c -d $(PARDIR) --gcov-tool=$(GCOV)
	genhtml -o $(PARDIR)/coverage/ $(PARDIR)/advent.info
	./coverage_dungeon.py

# Rebuild characterizing tests
buildchecks: savegames
	$(PARDIR)/cheat -s -1000 -o thousand_saves.adv > /tmp/regress1000saves
	@for file in $(TESTLOADS); do \
	    echo "Remaking $${file}.chk"; \
	    OPTS=`sed -n /#options:/s///p <$${file}.log`; \
	    advent $$OPTS <$${file}.log >$${file}.chk 2>&1 || exit 1; \
	done; \
	echo "inven" | advent issue36.log /dev/stdin >multifile.chk; \
	rm -f scratch.tmp

RUN_TARGETS=$(TESTLOADS:%=run-regress-%)
$(RUN_TARGETS): run-regress-%: %.log
	@(test=$(<:.log=); legend=$$(sed -n '/^## /s///p' <"$<" 2>/dev/null || echo "(no description)"); \
	OPTS=`sed -n /#options:/s///p $<`; \
	$(advent) $$OPTS <$< | tapdiffer "$${test}: $${legend}" "$${test}.chk")

multifile-regress:
	@(echo "inven" | advent issue36.log /dev/stdin) | tapdiffer "multifile: multiple-file test" multifile.chk

TEST_TARGETS = $(SCHECKS) $(RUN_TARGETS) multifile-regress

tap: count $(SGAMES) $(TEST_TARGETS)
	@rm -f scratch.tmp /tmp/coverage* /tmp/cheat*
count:
	@echo 1..$(words $(TEST_TARGETS))

# The following machinery tests the game against a binary made from
# the advent430 branch To use it, switch to that branch, build the
# binary, run it once to generate adventure.data, then switch back to
# master leaving advent430 and adventure.data in place (make clean
# does not remove them).
#
# make clean                 # Clean up object files, laving a bare source tree
# git checkout advent430     # Check out the advent430 branch
# make                       # Build the advent430 binary
# advent430                  # Run it.  Answer the novice question and quit
# make clean                 # Remove .o files
# git checkout master        # Go back to master branch
# make                       # Rebuild advent.
#
# The diff file produced has corrected spellings in it. That's what oldfilter
# is for, to massage out the original spellings and avoid noise diffs.
# Diffs in amount of whitespace and trailing whitespace are ignored
#
# A magic comment of NOCOMPARE in a log file excludes it from this comparison.
# making it a skipped test in the TAP view. First use of this was to avoid a
# spurious mismatch on the news text. Other uses avoid spurious mismatches due
# to bug fixes.
#
# When adding more tests, bear in mind that any game that continues after a
# resurrection will need a NOCOMPARE. At some point in the forward port,
# resurrection was accidentally changed in a way that messed with the LCG chain.
#
# The *.chk files need not be up-to-date for this to work.
#
TAPFILTER=tapview
oldcompare:
	@if [ -f ../advent430 ]; then cp ../advent430 ../adventure.data .; else echo "advent430 nonexistent"; exit 1; fi
	@-(for x in *.log; do \
		stem=$${x%.log}; \
		legend=$$(sed -n '/^## /s///p' <$$x 2>/dev/null || echo "(no description)"); \
		if grep NOCOMPARE $$x >/dev/null; \
			then echo "not ok - $${stem}.ochk: $${legend} # SKIP"; \
			else \
				./advent430 <$${stem}.log | oldfilter >$${stem}.ochk; \
				../advent <$${stem}.log >$${stem}.log-new; \
				./newfilter <$${stem}.log-new | tapdiffer -b "$${stem}: $${legend}" $${stem}.ochk; \
			fi; \
	done; \
	echo 1..$(words $(shell ls *.log))) | $(TAPFILTER)
	@rm *.ochk *-new advent430 adventure.data

# List all NOCOMPARE tests.
residuals:
	@grep -n NOCOMPARE *.log

# end
