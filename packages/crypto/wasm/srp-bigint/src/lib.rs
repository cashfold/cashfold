//! Constant-time modular exponentiation for SRP-6a over the 4096-bit RFC 3526 group.
//!
//! The only secret-dependent work is exponentiation by a secret exponent (`a`, `x`, `a + u*x`). It is done by
//! `crypto-bigint`'s Montgomery `pow`, which runs in time independent of the exponent's value for a fixed width.
//! Everything crosses the boundary as fixed 512-byte big-endian buffers, so lengths never depend on secrets.

use crypto_bigint::modular::{FixedMontyForm, FixedMontyParams};
use crypto_bigint::{Odd, U4096};

pub const SIZE: usize = 512;

/// Allocates `len` bytes in module memory for the caller to fill. Returns 0 on failure.
#[no_mangle]
pub extern "C" fn cf_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let ptr = v.as_mut_ptr();
    std::mem::forget(v);
    ptr
}

/// Zeroes and frees a buffer from `cf_alloc`.
#[no_mangle]
pub unsafe extern "C" fn cf_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    let slice = std::slice::from_raw_parts_mut(ptr, len);
    for b in slice.iter_mut() {
        std::ptr::write_volatile(b, 0);
    }
    drop(Vec::from_raw_parts(ptr, len, len));
}

/// `out = base ^ exp mod modulus`, all four being 512-byte big-endian numbers. The modulus must be odd and is public.
/// The base and exponent may be secret. `exp_bits` is a public upper bound on the exponent's bit length (at most 4096); the
/// running time depends on it and not on the exponent's value. Returns 0 on success and 1 if the modulus is even or zero or
/// the bound is out of range.
///
/// # Safety
/// Each pointer must address `SIZE` valid bytes.
#[no_mangle]
pub unsafe extern "C" fn cf_modpow(base: *const u8, exp: *const u8, exp_bits: u32, modulus: *const u8, out: *mut u8) -> u32 {
    if exp_bits == 0 || exp_bits > 4096 {
        return 1;
    }
    let m = U4096::from_be_slice(std::slice::from_raw_parts(modulus, SIZE));
    let Some(odd) = Option::<Odd<U4096>>::from(Odd::new(m)) else {
        return 1;
    };
    let params = FixedMontyParams::new_vartime(odd);
    let b = U4096::from_be_slice(std::slice::from_raw_parts(base, SIZE));
    let e = U4096::from_be_slice(std::slice::from_raw_parts(exp, SIZE));
    let r = FixedMontyForm::new(&b, &params).pow_bounded_exp(&e, exp_bits).retrieve();
    std::slice::from_raw_parts_mut(out, SIZE).copy_from_slice(r.to_be_bytes().as_ref());
    0
}

/// `out = a + u * x` for the SRP session exponent. The inputs are secret, so this runs here rather than in JavaScript
/// `bigint`, whose arithmetic takes time that depends on the values. The result must fit in 4096 bits; the caller passes
/// 256-bit inputs, so it always does.
///
/// # Safety
/// Each pointer must address `SIZE` valid bytes.
#[no_mangle]
pub unsafe extern "C" fn cf_exp_sum(a: *const u8, u: *const u8, x: *const u8, out: *mut u8) {
    let a = U4096::from_be_slice(std::slice::from_raw_parts(a, SIZE));
    let u = U4096::from_be_slice(std::slice::from_raw_parts(u, SIZE));
    let x = U4096::from_be_slice(std::slice::from_raw_parts(x, SIZE));
    let r = a.wrapping_add(&u.wrapping_mul(&x));
    std::slice::from_raw_parts_mut(out, SIZE).copy_from_slice(r.to_be_bytes().as_ref());
}
