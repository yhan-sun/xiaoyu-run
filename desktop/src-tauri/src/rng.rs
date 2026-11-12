//! 确定性伪随机源。
//!
//! 轨迹生成需要「同一个 seed 每次跑出同一条轨迹」—— 配速标定要反复二分调用
//! `emit(step)`，如果随机序列内部漂移，二分就不单调了。这里用 SplitMix64，
//! 状态小、质量足够、无外部依赖。

pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn new(seed: i64) -> Self {
        // 把 seed 打散一遍，避免相邻 seed（0/1/2）产生高度相关的序列
        let mut s = seed as u64;
        s = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
        s = (s ^ (s >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        s = (s ^ (s >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        s ^= s >> 31;
        Self {
            state: if s == 0 { 0x2545_F491_4F6C_DD1D } else { s },
        }
    }

    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// [0, 1)
    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        // 取高 53 位，正好是 f64 尾数精度
        (self.next_u64() >> 11) as f64 * (1.0 / 9_007_199_254_740_992.0)
    }

    /// [a, b)
    #[inline]
    pub fn uniform(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.next_f64()
    }

    /// [0, bound)
    #[inline]
    pub fn below(&mut self, bound: i32) -> i32 {
        if bound <= 0 {
            return 0;
        }
        (self.next_u64() % bound as u64) as i32
    }

    /// [from, until)
    #[inline]
    pub fn range(&mut self, from: i32, until: i32) -> i32 {
        if until <= from {
            return from;
        }
        from + self.below(until - from)
    }

    #[inline]
    pub fn boolean(&mut self) -> bool {
        self.next_u64() & 1 == 1
    }

    /// ±1 的随机符号
    #[inline]
    pub fn sign(&mut self) -> f64 {
        if self.boolean() {
            1.0
        } else {
            -1.0
        }
    }
}
