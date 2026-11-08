#! /bin/sh
# SPDX-FileCopyrightText: Copyright Eric S. Raymond <esr@thyrsus.com>
# SPDX-License-Identifier: BSD-2-Clause
case $? in
    0) echo "ok - $1 succeeded";;
    *) echo "not ok - $1 failed";;
esac
