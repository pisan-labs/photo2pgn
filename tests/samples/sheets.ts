// Two real scoresheets the owner sent (12 Nov 2026), transcribed as written,
// to check the engine on real notation habits. `truth` is the game where it
// is known.
export const DING_GUKESH_14 = {
  // FIDE World Championship 2024, round 14, Ding Liren's sheet: every
  // capture written without the x (cd4 for cxd4, Nd4 for Nxd4, Kf2 for Kxf2).
  written: `Nf3 d5 g3 c5 Bg2 Nc6 d4 e6 0-0 cd4 Nd4 Nge7 c4 Nd4 Qd4 Nc6 Qd1 d4 e3 Bc5 ed4 Bd4 Nc3 0-0 Nb5 Bb6 b3 a6
    Nc3 Bd4 Bb2 e5 Qd2 Be6 Nd5 b5 cb5 ab5 Nf4 ef4 Bc6 Bb2 Qb2 Rb8 Rfd1 Qb6 Bf3 fg3 hg3 b4 a4 ba3 Ra3 g6 Qd4 Qb5
    b4 Qb4 Qb4 Rb4 Ra8 Ra8 Ba8 g5 Bd5 Bf5 Rc1 Kg7 Rc7 Bg6 Rc4 Rb1+ Kg2 Re1 Rb4 h5 Ra4 Re5 Bf3 Kh6 Kg1 Re6 Rc4 g4
    Bd5 Rd6 Bb7 Kg5 f3 f5 fg4 hg4 Rb4 Bf7 Kf2 Rd2+ Kg1 Kf6 Rb6+ Kg5 Rb4 Be6 Ra4 Rb2 Ba8 Kf6 Rf4 Ke5 Rf2 Rf2 Kf2 Bd5
    Bd5 Kd5 Ke3 Ke5`.split(/\s+/),
  truth: `Nf3 d5 g3 c5 Bg2 Nc6 d4 e6 O-O cxd4 Nxd4 Nge7 c4 Nxd4 Qxd4 Nc6 Qd1 d4 e3 Bc5 exd4 Bxd4 Nc3 O-O Nb5 Bb6 b3 a6
    Nc3 Bd4 Bb2 e5 Qd2 Be6 Nd5 b5 cxb5 axb5 Nf4 exf4 Bxc6 Bxb2 Qxb2 Rb8 Rfd1 Qb6 Bf3 fxg3 hxg3 b4 a4 bxa3 Rxa3 g6
    Qd4 Qb5 b4 Qxb4 Qxb4 Rxb4 Ra8 Rxa8 Bxa8 g5 Bd5 Bf5 Rc1 Kg7 Rc7 Bg6 Rc4 Rb1+ Kg2 Re1 Rb4 h5 Ra4 Re5 Bf3 Kh6 Kg1
    Re6 Rc4 g4 Bd5 Rd6 Bb7 Kg5 f3 f5 fxg4 hxg4 Rb4 Bf7 Kf2 Rd2+ Kg1 Kf6 Rb6+ Kg5 Rb4 Be6 Ra4 Rb2 Ba8 Kf6 Rf4 Ke5
    Rf2 Rxf2 Kxf2 Bd5 Bxd5 Kxd5 Ke3 Ke5`.split(/\s+/),
};

export const CHESSCOM_SHEET = {
  // A club game on a Chess.com sheet, round 2, legible, with the slips real
  // sheets have (from move 22 on the moves stop fitting the game).
  written: `e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O b5 Bb3 Bc5 Re1 O-O c3 d6 h3 Bb6 d4 Bb7 Bc2 exd4 cxd4 Nb4 Bb3 Bxe4
    Bg5 d5 Nc3 Re8 Ne5 h6 Bh4 g5 Bg3 Kg7 a3 Nh5 axb4 Nxg3 fxg3 Rxe5 Kh2 Nxe4 Re8 dxe4 Qh5 Re7 Rf1 f6 Rf5 Qe8
    Qe2 Bxd4 Rc1 Be5 Bd5`.split(/\s+/),
};
